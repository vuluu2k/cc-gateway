import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'
import { migrateFromConfig } from '../src/migrate-accounts.js'
import { listAccountRows, listClientRows, listBindings } from '../src/accounts-store.js'
import type { Config } from '../src/config.js'

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

const legacyConfig = {
  oauth: { access_token: 'acc-tok', refresh_token: 'ref-tok', expires_at: 1234 },
  auth: {
    tokens: [
      { name: 'alice', token: 'tok-a', cost_limit_usd: 10, cost_limit_period: 'monthly' },
      { name: 'bob', token: 'tok-b', home_dir: '/home/bob' },
    ],
  },
  identity: { device_id: 'cd'.repeat(32), email: 'legacy@example.com' },
} as unknown as Config

console.log('\nmigration - config.yaml → DB\n')

// A pre-existing metrics row from before this migration, with no account_id yet.
getDb()
  .prepare(
    `INSERT INTO request_metrics (ts, client, method, path, status, duration_ms)
     VALUES (0, 'alice', 'POST', '/v1/messages', 200, 5)`,
  )
  .run()

test('migrate tạo một account default mang identity cũ', () => {
  assert.equal(migrateFromConfig(legacyConfig), true)
  const accounts = listAccountRows()
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].id, 'default')
  assert.equal(accounts[0].refreshToken, 'ref-tok')
  assert.equal(accounts[0].accessToken, 'acc-tok')
  assert.equal(accounts[0].expiresAt, 1234)
  assert.equal(accounts[0].deviceId, 'cd'.repeat(32))
  assert.equal(accounts[0].email, 'legacy@example.com')
  assert.equal(accounts[0].env, null)
})

test('mỗi auth.tokens thành một client', () => {
  const clients = listClientRows()
  assert.equal(clients.length, 2)
  assert.deepEqual(clients.map((c) => c.name), ['alice', 'bob'])
  assert.equal(clients.find((c) => c.name === 'bob')!.homeDir, '/home/bob')
})

test('cost limit cũ chuyển sang binding tới default', () => {
  const alice = listBindings('alice')
  assert.equal(alice.length, 1)
  assert.equal(alice[0].accountId, 'default')
  assert.equal(alice[0].priority, 0)
  assert.equal(alice[0].limitUsd, 10)
  assert.equal(alice[0].limitPeriod, 'monthly')

  const bob = listBindings('bob')
  assert.equal(bob[0].limitUsd, 0)
  assert.equal(bob[0].limitPeriod, 'lifetime')
})

test('metrics cũ được gán về account default', () => {
  const row = getDb()
    .prepare(`SELECT account_id FROM request_metrics WHERE client = 'alice'`)
    .get() as { account_id: string }
  assert.equal(row.account_id, 'default')
})

test('chạy lần hai là no-op, không nhân đôi', () => {
  assert.equal(migrateFromConfig(legacyConfig), false)
  assert.equal(listAccountRows().length, 1)
  assert.equal(listClientRows().length, 2)
  assert.equal(listBindings('alice').length, 1)
})

test('config không có oauth thì không migrate gì', () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'ccg-test-'))
  initDb(join(dir2, 'fresh.db'))
  assert.equal(migrateFromConfig({} as Config), false)
  assert.equal(listAccountRows().length, 0)
  rmSync(dir2, { recursive: true, force: true })
})

test('config trung ten client thi bo qua ban sau, khong nem', () => {
  const dir3 = mkdtempSync(join(tmpdir(), 'ccg-test-'))
  initDb(join(dir3, 'dup.db'))
  const dupConfig = {
    oauth: { refresh_token: 'ref-dup' },
    auth: {
      tokens: [
        { name: 'alice', token: 'tok-1' },
        { name: 'alice', token: 'tok-2' },
      ],
    },
    identity: { device_id: 'ef'.repeat(32), email: 'dup@example.com' },
  } as unknown as Config
  assert.doesNotThrow(() => migrateFromConfig(dupConfig))
  assert.equal(listClientRows().length, 1)
  assert.equal(listAccountRows().length, 1)
  rmSync(dir3, { recursive: true, force: true })
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
