import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { recordRequest, getClientAccountCostSince, getClientCostSince } from '../src/metrics.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'test.db'))

console.log('\nmetrics - chi phí theo cặp (client, account)\n')

function spend(client: string, accountId: string, costUsd: number) {
  recordRequest({
    ts: Date.now(),
    client,
    accountId,
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 10,
    costUsd,
  })
}

test('cộng dồn riêng từng account', () => {
  spend('alice', 'pro-1', 3)
  spend('alice', 'pro-1', 2)
  spend('alice', 'pro-2', 7)
  assert.equal(getClientAccountCostSince('alice', 'pro-1', 0), 5)
  assert.equal(getClientAccountCostSince('alice', 'pro-2', 0), 7)
})

test('không lẫn chi phí của client khác', () => {
  spend('bob', 'pro-1', 100)
  assert.equal(getClientAccountCostSince('alice', 'pro-1', 0), 5)
  assert.equal(getClientAccountCostSince('bob', 'pro-1', 0), 100)
})

test('getClientCostSince vẫn là tổng mọi account', () => {
  assert.equal(getClientCostSince('alice', 0), 12)
})

test('cặp chưa tiêu gì trả về 0', () => {
  assert.equal(getClientAccountCostSince('alice', 'max-1', 0), 0)
  assert.equal(getClientAccountCostSince('nobody', 'pro-1', 0), 0)
})

test('sinceTs lọc theo mốc thời gian', () => {
  const future = Date.now() + 60_000
  assert.equal(getClientAccountCostSince('alice', 'pro-1', future), 0)
})

import {
  createAccount, selectAccountFor, _resetAccountsRuntime,
} from '../src/accounts.js'
import {
  updateAccountRow, insertClientRow, replaceBindings,
} from '../src/accounts-store.js'

console.log('\nrouting - selectAccountFor\n')

const HOUR = 60 * 60 * 1000

function makeLiveAccount(id: string) {
  createAccount({ id })
  updateAccountRow(id, {
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAt: Date.now() + HOUR,
    state: 'ok',
  })
}

_resetAccountsRuntime()
makeLiveAccount('acc-a')
makeLiveAccount('acc-b')
makeLiveAccount('acc-c')
insertClientRow({ name: 'carol', token: 'tok-carol' })

test('chọn account có priority nhỏ nhất', () => {
  replaceBindings('carol', [
    { accountId: 'acc-b', priority: 9, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'acc-a')
  assert.equal(r.ok && r.accessToken, 'token-acc-a')
})

test('hết hạn mức thì tràn xuống account kế tiếp', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'acc-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('carol', 'acc-a', 10)
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-b')
})

test('limitUsd = 0 là không giới hạn, không phải chặn', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-a')
})

test('cạn mọi account → reason quota, liệt kê đủ used/limit', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'acc-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('carol', 'acc-b', 5)
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'quota')
  const blocked = !r.ok && r.reason === 'quota' ? r.blocked : []
  assert.equal(blocked.length, 2)
  assert.deepEqual(blocked.map((b) => b.accountId).sort(), ['acc-a', 'acc-b'])
  assert.equal(blocked.find((b) => b.accountId === 'acc-a')!.usedUsd, 10)
  assert.equal(blocked.find((b) => b.accountId === 'acc-a')!.limitUsd, 10)
})

test('đường không tính tiền vẫn đi được dù cạn hạn mức', () => {
  const r = selectAccountFor('carol', false)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'acc-a')
})

test('bỏ qua account expired, dùng cái kế tiếp', () => {
  updateAccountRow('acc-a', { state: 'expired', accessToken: '', expiresAt: 0 })
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'acc-c', priority: 2, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-c')
})

test('bỏ qua account bị tắt', () => {
  updateAccountRow('acc-c', { enabled: false })
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'unavailable')
  updateAccountRow('acc-c', { enabled: true })
})

test('client không có binding → reason no-bindings', () => {
  insertClientRow({ name: 'dave', token: 'tok-dave' })
  const r = selectAccountFor('dave', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'no-bindings')
})

test('hạn mức hết hạn theo chu kỳ: daily tính lại từ đầu ngày UTC', () => {
  insertClientRow({ name: 'erin', token: 'tok-erin' })
  replaceBindings('erin', [
    { accountId: 'acc-b', priority: 1, limitUsd: 1, limitPeriod: 'daily' },
  ])
  // Yesterday's spend must not count against today's daily limit.
  recordRequest({
    ts: Date.now() - 48 * HOUR,
    client: 'erin',
    accountId: 'acc-b',
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 1,
    costUsd: 99,
  })
  const r = selectAccountFor('erin', true)
  assert.equal(r.ok && r.accountId, 'acc-b')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
rmSync(dir, { recursive: true, force: true })
