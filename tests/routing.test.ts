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

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
rmSync(dir, { recursive: true, force: true })
