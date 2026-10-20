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

rmSync(dir, { recursive: true, force: true })
console.log('setup tests passed')
