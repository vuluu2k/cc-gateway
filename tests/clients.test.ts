import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { insertAccountRow, listBindings, replaceBindings } from '../src/accounts-store.js'
import { addClient, removeClient, listClients, setClientHomeDir } from '../src/clients.js'
import { lookupToken } from '../src/auth.js'

initDb(join(mkdtempSync(join(tmpdir(), 'ccg-test-')), 'test.db'))

const c = addClient('alice')
assert.equal(lookupToken(c.token)?.name, 'alice', 'new client authenticates without a restart')
assert.throws(() => addClient('alice'), /already exists/)
assert.throws(() => addClient('bad name!'), /client name/)

assert.equal(setClientHomeDir('alice', '/Users/alice/').home_dir, '/Users/alice')
assert.equal(lookupToken(c.token)?.homeDir, '/Users/alice')
assert.equal(setClientHomeDir('alice', null).home_dir, undefined)
assert.throws(() => setClientHomeDir('alice', 'relative'), /absolute/)
assert.throws(() => setClientHomeDir('nobody', null), /not found/)

const acc = insertAccountRow({ id: 'pro-1', label: 'Pro' } as Parameters<typeof insertAccountRow>[0])
replaceBindings('alice', [{ accountId: acc.id, priority: 1, limitUsd: 10, limitPeriod: 'monthly' }])
assert.equal(listBindings('alice').length, 1)

assert.equal(removeClient('alice'), true)
assert.equal(lookupToken(c.token), null, 'removed client no longer authenticates')
assert.equal(listBindings('alice').length, 0, 'bindings cascade')
assert.equal(removeClient('alice'), false)
assert.deepEqual(listClients(), [])
console.log('clients: ok')
