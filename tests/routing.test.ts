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

function makeExpiredAccount(id: string) {
  createAccount({ id })
  updateAccountRow(id, {
    accessToken: '',
    refreshToken: `refresh-${id}`,
    expiresAt: 0,
    state: 'expired',
  })
}

function makeDisabledAccount(id: string) {
  makeLiveAccount(id)
  updateAccountRow(id, { enabled: false })
}

_resetAccountsRuntime()

// Every test below owns its own client name, its own accounts, its own
// bindings and its own spend — no test may rely on a row an earlier test
// created. That is what makes each one correct in isolation, not just when
// run in this file's declared order.

test('chọn account có priority nhỏ nhất', () => {
  makeLiveAccount('sel-priority-a')
  makeLiveAccount('sel-priority-b')
  insertClientRow({ name: 'sel-priority-client', token: 'tok-sel-priority' })
  replaceBindings('sel-priority-client', [
    { accountId: 'sel-priority-b', priority: 9, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'sel-priority-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('sel-priority-client', true)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'sel-priority-a')
  assert.equal(r.ok && r.accessToken, 'token-sel-priority-a')
})

test('hết hạn mức thì tràn xuống account kế tiếp', () => {
  makeLiveAccount('sel-fallback-a')
  makeLiveAccount('sel-fallback-b')
  insertClientRow({ name: 'sel-fallback-client', token: 'tok-sel-fallback' })
  replaceBindings('sel-fallback-client', [
    { accountId: 'sel-fallback-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'sel-fallback-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('sel-fallback-client', 'sel-fallback-a', 10)
  const r = selectAccountFor('sel-fallback-client', true)
  assert.equal(r.ok && r.accountId, 'sel-fallback-b')
})

test('limitUsd = 0 là không giới hạn, không phải chặn', () => {
  makeLiveAccount('sel-unlimited-a')
  insertClientRow({ name: 'sel-unlimited-client', token: 'tok-sel-unlimited' })
  replaceBindings('sel-unlimited-client', [
    { accountId: 'sel-unlimited-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('sel-unlimited-client', true)
  assert.equal(r.ok && r.accountId, 'sel-unlimited-a')
})

test('cạn mọi account → reason quota, liệt kê đủ used/limit', () => {
  makeLiveAccount('sel-quota-a')
  makeLiveAccount('sel-quota-b')
  insertClientRow({ name: 'sel-quota-client', token: 'tok-sel-quota' })
  replaceBindings('sel-quota-client', [
    { accountId: 'sel-quota-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'sel-quota-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('sel-quota-client', 'sel-quota-a', 10)
  spend('sel-quota-client', 'sel-quota-b', 5)
  const r = selectAccountFor('sel-quota-client', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'quota')
  const blocked = !r.ok && r.reason === 'quota' ? r.blocked : []
  assert.equal(blocked.length, 2)
  assert.deepEqual(blocked.map((b) => b.accountId).sort(), ['sel-quota-a', 'sel-quota-b'])
  assert.equal(blocked.find((b) => b.accountId === 'sel-quota-a')!.usedUsd, 10)
  assert.equal(blocked.find((b) => b.accountId === 'sel-quota-a')!.limitUsd, 10)
})

test('đường không tính tiền vẫn đi được dù cạn hạn mức', () => {
  makeLiveAccount('sel-free-a')
  makeLiveAccount('sel-free-b')
  insertClientRow({ name: 'sel-free-client', token: 'tok-sel-free' })
  replaceBindings('sel-free-client', [
    { accountId: 'sel-free-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'sel-free-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('sel-free-client', 'sel-free-a', 10)
  spend('sel-free-client', 'sel-free-b', 5)
  const r = selectAccountFor('sel-free-client', false)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'sel-free-a')
})

test('bỏ qua account expired, dùng cái kế tiếp', () => {
  makeExpiredAccount('sel-expired-a')
  makeLiveAccount('sel-expired-c')
  insertClientRow({ name: 'sel-expired-client', token: 'tok-sel-expired' })
  replaceBindings('sel-expired-client', [
    { accountId: 'sel-expired-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'sel-expired-c', priority: 2, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('sel-expired-client', true)
  assert.equal(r.ok && r.accountId, 'sel-expired-c')
})

test('bỏ qua account bị tắt', () => {
  makeDisabledAccount('sel-disabled-a')
  insertClientRow({ name: 'sel-disabled-client', token: 'tok-sel-disabled' })
  replaceBindings('sel-disabled-client', [
    { accountId: 'sel-disabled-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('sel-disabled-client', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'unavailable')
})

test('client không có binding → reason no-bindings', () => {
  insertClientRow({ name: 'sel-nobindings-client', token: 'tok-sel-nobindings' })
  const r = selectAccountFor('sel-nobindings-client', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'no-bindings')
})

test('hạn mức hết hạn theo chu kỳ: daily tính lại từ đầu ngày UTC', () => {
  makeLiveAccount('sel-daily-a')
  insertClientRow({ name: 'sel-daily-client', token: 'tok-sel-daily' })
  replaceBindings('sel-daily-client', [
    { accountId: 'sel-daily-a', priority: 1, limitUsd: 1, limitPeriod: 'daily' },
  ])
  // Yesterday's spend must not count against today's daily limit.
  recordRequest({
    ts: Date.now() - 48 * HOUR,
    client: 'sel-daily-client',
    accountId: 'sel-daily-a',
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 1,
    costUsd: 99,
  })
  const r = selectAccountFor('sel-daily-client', true)
  assert.equal(r.ok && r.accountId, 'sel-daily-a')
})

test('cạn hạn mức + account khác đã chết → vẫn là quota, blocked chỉ gồm cái còn sống', () => {
  makeLiveAccount('sel-mixed-a')
  makeExpiredAccount('sel-mixed-b')
  insertClientRow({ name: 'sel-mixed-client', token: 'tok-sel-mixed' })
  replaceBindings('sel-mixed-client', [
    { accountId: 'sel-mixed-a', priority: 1, limitUsd: 5, limitPeriod: 'lifetime' },
    { accountId: 'sel-mixed-b', priority: 2, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  spend('sel-mixed-client', 'sel-mixed-a', 5)
  const r = selectAccountFor('sel-mixed-client', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'quota')
  const blocked = !r.ok && r.reason === 'quota' ? r.blocked : []
  // sel-mixed-b never reaches the quota check — it has no usable access
  // token — so it must NOT appear in `blocked`. `blocked` means "exhausted
  // and live", not "every over-limit binding".
  assert.equal(blocked.length, 1)
  assert.equal(blocked[0].accountId, 'sel-mixed-a')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
rmSync(dir, { recursive: true, force: true })
