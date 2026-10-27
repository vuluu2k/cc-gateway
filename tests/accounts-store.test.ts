import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'
import {
  insertAccountRow, getAccountRow, updateAccountRow, deleteAccountRow,
  listAccountRows, generateDeviceId,
  insertClientRow, listBindings, replaceBindings, listBindingsForAccount,
} from '../src/accounts-store.js'

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

console.log('\nschema - accounts / clients / client_accounts\n')

test('tạo đủ ba bảng mới', () => {
  const names = (getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>).map((r) => r.name)
  assert.ok(names.includes('accounts'))
  assert.ok(names.includes('clients'))
  assert.ok(names.includes('client_accounts'))
})

test('request_metrics có cột account_id mặc định rỗng', () => {
  const cols = (getDb()
    .prepare('PRAGMA table_info(request_metrics)')
    .all() as Array<{ name: string }>).map((c) => c.name)
  assert.ok(cols.includes('account_id'))
})

test('client_accounts cascade khi xoá client', () => {
  const db = getDb()
  // Bind device_id as a parameter: SQLite parses SQL, it does not run
  // JavaScript, so `.repeat()` inside a SQL string is a syntax error.
  db.prepare(
    'INSERT INTO accounts (id, device_id, created_at) VALUES (?, ?, ?)',
  ).run('a1', 'ab'.repeat(32), 0)
  db.prepare(
    'INSERT INTO clients (name, token, created_at) VALUES (?, ?, ?)',
  ).run('c1', 'tok1', 0)
  db.prepare(
    'INSERT INTO client_accounts (client_name, account_id) VALUES (?, ?)',
  ).run('c1', 'a1')
  db.prepare(`DELETE FROM clients WHERE name = 'c1'`).run()
  const left = db
    .prepare(`SELECT COUNT(*) AS n FROM client_accounts`)
    .get() as { n: number }
  assert.equal(left.n, 0)
  // Clean up test data
  db.prepare('DELETE FROM accounts WHERE id = ?').run('a1')
})

test('chạy migrate hai lần không lỗi', () => {
  // initDb runs migrate; calling it again on the same file must be a silent no-op
  initDb(join(dir, 'test.db'))
  const names = (getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>).map((r) => r.name)
  assert.ok(names.includes('accounts'))
})

console.log('\naccounts-store\n')

test('generateDeviceId sinh 64 hex', () => {
  const id = generateDeviceId()
  assert.equal(id.length, 64)
  assert.ok(/^[0-9a-f]{64}$/.test(id))
  assert.notEqual(id, generateDeviceId())
})

test('insertAccountRow điền mặc định và sinh device_id', () => {
  const acc = insertAccountRow({ id: 'pro-1', label: 'Pro 1' })
  assert.equal(acc.id, 'pro-1')
  assert.equal(acc.state, 'uninitialized')
  assert.equal(acc.enabled, true)
  assert.equal(acc.deviceId.length, 64)
  assert.equal(acc.env, null)
})

test('insertAccountRow trùng id thì ném lỗi', () => {
  assert.throws(() => insertAccountRow({ id: 'pro-1' }))
})

test('updateAccountRow round-trip env qua JSON', () => {
  const acc = updateAccountRow('pro-1', { env: { platform: 'linux', arch: 'x64' } })
  assert.deepEqual(acc.env, { platform: 'linux', arch: 'x64' })
  assert.deepEqual(getAccountRow('pro-1')!.env, { platform: 'linux', arch: 'x64' })
})

test('updateAccountRow chỉ đổi trường được truyền', () => {
  const acc = updateAccountRow('pro-1', { state: 'ok' })
  assert.equal(acc.state, 'ok')
  assert.equal(acc.label, 'Pro 1')
  assert.deepEqual(acc.env, { platform: 'linux', arch: 'x64' })
})

test('replaceBindings thay cả mảng, sắp theo priority', () => {
  insertAccountRow({ id: 'pro-2' })
  insertClientRow({ name: 'alice', token: 'tok-alice' })
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 5, limitUsd: 5, limitPeriod: 'monthly' },
    { accountId: 'pro-1', priority: 1, limitUsd: 10, limitPeriod: 'monthly' },
  ])
  const rows = listBindings('alice')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].accountId, 'pro-1')
  assert.equal(rows[0].limitUsd, 10)
  assert.equal(rows[1].accountId, 'pro-2')
})

test('replaceBindings gọi lần hai xoá binding cũ', () => {
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 0, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const rows = listBindings('alice')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].accountId, 'pro-2')
})

test('listBindingsForAccount thấy client đang dùng account', () => {
  const rows = listBindingsForAccount('pro-2')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].clientName, 'alice')
})

test('deleteAccountRow xoá luôn binding', () => {
  deleteAccountRow('pro-2')
  assert.equal(getAccountRow('pro-2'), null)
  assert.equal(listBindings('alice').length, 0)
  assert.equal(listAccountRows().length, 1)
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
