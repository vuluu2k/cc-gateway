import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { updateAccountRow } from '../src/accounts-store.js'
import {
  initAccounts, listAccounts, getAccountView, createAccount, updateAccount,
  deleteAccount, getAccessTokenFor, isUsable, beginLogin, cancelLogin,
  _resetAccountsRuntime,
} from '../src/accounts.js'
import { insertClientRow, replaceBindings } from '../src/accounts-store.js'

let passed = 0
let failed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
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

console.log('\naccounts - runtime\n')

await test('createAccount sinh device_id và trạng thái ban đầu', () => {
  const acc = createAccount({ id: 'pro-1', label: 'Pro 1' })
  assert.equal(acc.id, 'pro-1')
  assert.equal(acc.state, 'uninitialized')
  assert.equal(acc.hasRefreshToken, false)
  assert.equal(acc.enabled, true)
  assert.equal(acc.deviceId.length, 64)
  assert.equal(acc.loginPending, false)
})

await test('device_id của hai account là khác nhau', () => {
  const a = getAccountView('pro-1')!
  const b = createAccount({ id: 'pro-2' })
  assert.notEqual(a.deviceId, b.deviceId)
})

await test('AccountView không lộ refresh_token', () => {
  const acc = getAccountView('pro-1')! as Record<string, unknown>
  assert.equal(acc.refreshToken, undefined)
  assert.equal(acc.accessToken, undefined)
})

await test('createAccount trùng id thì ném lỗi', () => {
  assert.throws(() => createAccount({ id: 'pro-1' }))
})

await test('account chưa login thì không dùng được', () => {
  assert.equal(getAccessTokenFor('pro-1'), null)
  assert.equal(isUsable('pro-1'), false)
})

await test('account có token còn hạn thì dùng được', async () => {
  updateAccountRow('pro-1', {
    accessToken: 'live-token',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    state: 'ok',
  })
  _resetAccountsRuntime()
  await initAccounts()
  assert.equal(getAccessTokenFor('pro-1'), 'live-token')
  assert.equal(isUsable('pro-1'), true)
})

await test('token hết hạn thì không dùng được', () => {
  updateAccountRow('pro-1', { expiresAt: Date.now() - 1000 })
  _resetAccountsRuntime()
  assert.equal(getAccessTokenFor('pro-1'), null)
})

await test('một account expired không ảnh hưởng account còn lại', async () => {
  updateAccountRow('pro-1', {
    accessToken: 'live-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    state: 'ok',
  })
  updateAccountRow('pro-2', { state: 'expired', lastError: 'invalid_grant' })
  _resetAccountsRuntime()
  await initAccounts()
  assert.equal(isUsable('pro-1'), true)
  assert.equal(isUsable('pro-2'), false)
  assert.equal(getAccountView('pro-2')!.state, 'expired')
})

await test('account bị tắt thì không dùng được dù token còn hạn', () => {
  updateAccount('pro-1', { enabled: false })
  assert.equal(isUsable('pro-1'), false)
  updateAccount('pro-1', { enabled: true })
  assert.equal(isUsable('pro-1'), true)
})

await test('bật lại account đã tắt sẽ chạy lại initOne, không giữ state cũ', () => {
  // Regression for: re-enabling an account never re-armed its refresh timer
  // or re-derived its state — it just kept whatever `state` was written
  // before it got disabled, forever.
  createAccount({ id: 'pro-3' })
  updateAccountRow('pro-3', {
    accessToken: 'stale-token',
    refreshToken: 'refresh-3',
    expiresAt: Date.now() + 60 * 60 * 1000,
    state: 'ok',
  })
  updateAccount('pro-3', { enabled: false })
  // While disabled, its refresh_token disappears and its access token goes
  // stale (e.g. it sat disabled long enough to expire) — but the row still
  // reads the 'ok' state written before it was disabled, since disabling
  // never re-derives state.
  updateAccountRow('pro-3', { refreshToken: '', expiresAt: Date.now() - 1000 })
  updateAccount('pro-3', { enabled: true })
  // Re-enabling must re-run initOne's decision: no refresh_token and an
  // expired access token means this account is actually uninitialized, not
  // still 'ok'. Before the fix, re-enable did nothing and this stayed stuck
  // reporting 'ok' — a healthy-looking account with no way to ever refresh.
  assert.equal(getAccountView('pro-3')!.state, 'uninitialized')
  deleteAccount('pro-3')
})

await test('beginLogin đánh dấu loginPending, cancelLogin gỡ ra', () => {
  const started = beginLogin('pro-2')
  assert.ok(started.url.startsWith('https://claude.com/cai/oauth/authorize'))
  assert.equal(getAccountView('pro-2')!.loginPending, true)
  // pro-2's pending login must not leak into pro-1
  assert.equal(getAccountView('pro-1')!.loginPending, false)
  cancelLogin('pro-2')
  assert.equal(getAccountView('pro-2')!.loginPending, false)
})

await test('deleteAccount bị chặn khi còn binding', () => {
  insertClientRow({ name: 'alice', token: 'tok-a' })
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 0, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  assert.throws(() => deleteAccount('pro-2'), /alice/)
})

await test('deleteAccount chạy khi không còn binding', () => {
  replaceBindings('alice', [])
  deleteAccount('pro-2')
  assert.equal(getAccountView('pro-2'), null)
  assert.equal(listAccounts().length, 1)
})

// Re-enabling an account now re-arms its refresh timer (see the "bật lại
// account" test above), so a live setTimeout can still be outstanding here —
// clear everything before exit or the process hangs instead of finishing.
_resetAccountsRuntime()
rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
