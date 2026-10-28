import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { recordRequest, getMetricsSnapshot } from '../src/metrics.js'

initDb(join(mkdtempSync(join(tmpdir(), 'ccg-test-')), 'test.db'))

const now = Date.now()
const H = 3_600_000
const req = (ts: number, client: string, extra: Record<string, unknown> = {}) =>
  recordRequest({ ts, client, method: 'POST', path: '/v1/messages', status: 200, durationMs: 100, ...extra })

// last 24h: alice $3 + bob $1, one upstream error
req(now - H, 'alice', { costUsd: 3, inputTokens: 100, cacheReadTokens: 300, accountId: 'pro-1' })
req(now - 2 * H, 'bob', { costUsd: 1 })
req(now - 3 * H, 'bob', { status: 529, errorSource: 'upstream', accountId: 'pro-1' })
// previous 24h: $2, must not leak into last24h
req(now - 30 * H, 'carol', { costUsd: 2, accountId: 'pro-2' })

const { kpis, periods } = getMetricsSnapshot()
assert.equal(kpis.last24h.total, 3)
assert.equal(kpis.last24h.costUsd, 4)
assert.equal(kpis.last24h.errors, 1)
assert.equal(kpis.last24h.upstreamErrors, 1)
assert.equal(kpis.last24h.gatewayErrors, 0)
assert.equal(kpis.last24h.activeClients, 2)
assert.equal(kpis.last24h.cacheReadTokens, 300)
assert.equal(kpis.prev24h.total, 1)
assert.equal(kpis.prev24h.costUsd, 2)
assert.deepEqual(kpis.topSpender, { client: 'alice', costUsd: 3 })
assert.equal(periods.find((p) => p.key === 'today')?.errors, 1)
// per account, last 24h only: pro-2's request is 30h old
assert.deepEqual(kpis.byAccount24h, { 'pro-1': { requests: 2, costUsd: 3, errors: 1 } })

console.log('metrics kpis: 12 passed, 0 failed')
