import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'

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
})

test('chạy migrate hai lần không lỗi', () => {
  // initDb gọi migrate; gọi lại trên cùng file phải im lặng thành công
  initDb(join(dir, 'test.db'))
  const names = (getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>).map((r) => r.name)
  assert.ok(names.includes('accounts'))
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
