import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'
import { currentSetupCode, checkSetupCode, consumeSetupCode, createUser } from '../src/users.js'
import { seedAccountFromEnvIfEmpty } from '../src/bootstrap-config.js'
import type { Config } from '../src/config.js'

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'setup.db'))

const code = currentSetupCode()!
assert.ok(code)
assert.equal(currentSetupCode(), code, 'stable across calls')
assert.equal(checkSetupCode('wrong'), false)
assert.equal(checkSetupCode(''), false)

// expiry issues a fresh code
getDb().prepare(`UPDATE meta SET value = ? WHERE key = 'setup_code'`).run(`${code}:${Date.now() - 1}`)
const code2 = currentSetupCode()!
assert.notEqual(code2, code)
assert.equal(consumeSetupCode(code), false)

// single use
assert.equal(consumeSetupCode(code2), true)
assert.equal(consumeSetupCode(code2), false)

// no code once a user exists
const code3 = currentSetupCode()!
createUser('admin', 'password123')
assert.equal(currentSetupCode(), null)
assert.equal(checkSetupCode(code3), false)

// env seeding: no credentials -> no-op
delete process.env.CCG_REFRESH_TOKEN
delete process.env.CCG_CREDENTIALS_PATH
assert.equal(seedAccountFromEnvIfEmpty({} as Config), false)
process.env.CCG_REFRESH_TOKEN = 'rt-env'
assert.equal(seedAccountFromEnvIfEmpty({ identity: { device_id: 'ab'.repeat(32) } } as unknown as Config), true)
assert.equal(seedAccountFromEnvIfEmpty({} as Config), false, 'only when empty')

// deleting every account must not let the env seed resurrect "default"
getDb().prepare(`DELETE FROM accounts`).run()
assert.equal(seedAccountFromEnvIfEmpty({} as Config), false, 'no resurrection after delete-all')
assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n, 0)

// a DB whose accounts were created from the dashboard (no flag yet) is closed too
const dir2 = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir2, 'dash.db'))
getDb().prepare(`INSERT INTO accounts (id, device_id, created_at) VALUES ('web', ?, 0)`).run('ab'.repeat(32))
assert.equal(seedAccountFromEnvIfEmpty({} as Config), false)
getDb().prepare(`DELETE FROM accounts`).run()
assert.equal(seedAccountFromEnvIfEmpty({} as Config), false, 'flag recorded on first sighting')
rmSync(dir2, { recursive: true, force: true })
delete process.env.CCG_REFRESH_TOKEN

rmSync(dir, { recursive: true, force: true })
console.log('setup tests passed')
