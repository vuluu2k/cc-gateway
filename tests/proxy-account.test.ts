import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer } from 'http'
import { strict as assert } from 'assert'
import Database from 'better-sqlite3'
import { initDb, getDb } from '../src/db.js'
import { insertAccountRow, getAccountRow, updateAccountRow } from '../src/accounts-store.js'
import { getProxyAgent, maskProxyUrl, validateProxyUrl } from '../src/proxy-agent.js'
import { refreshOAuthToken } from '../src/oauth-client.js'
import { sanitizeAccountPatch } from '../src/proxy.js'

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

const dir = mkdtempSync(join(tmpdir(), 'ccg-proxy-'))

console.log('\nper-account proxy - store\n')

await test('existing DB without proxy_url gets the column, rows stay readable', () => {
  const path = join(dir, 'old.db')
  const old = new Database(path)
  old.exec(`CREATE TABLE accounts (
    id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', refresh_token TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'uninitialized', last_error TEXT NOT NULL DEFAULT '',
    last_refresh_at INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    env_json TEXT NOT NULL DEFAULT '', prompt_env_json TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`)
  old.prepare("INSERT INTO accounts (id, device_id, created_at) VALUES ('legacy', ?, 1)").run('a'.repeat(64))
  old.close()
  initDb(path)
  const cols = getDb().prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
  assert.ok(cols.some((c) => c.name === 'proxy_url'))
  assert.equal(getAccountRow('legacy')!.proxyUrl, '')
  initDb(path) // idempotent
})

await test('proxyUrl round-trips through insert and update', () => {
  initDb(join(dir, 'new.db'))
  const row = insertAccountRow({ id: 'a1', proxyUrl: 'http://u:p@h:8080' })
  assert.equal(row.proxyUrl, 'http://u:p@h:8080')
  assert.equal(insertAccountRow({ id: 'a2' }).proxyUrl, '')
  assert.equal(updateAccountRow('a1', { proxyUrl: 'https://x:1' }).proxyUrl, 'https://x:1')
  assert.equal(updateAccountRow('a1', { proxyUrl: '' }).proxyUrl, '')
})

console.log('\nper-account proxy - agent, validation, masking\n')

await test('getProxyAgent: empty = global/null, per-URL cached', () => {
  assert.equal(getProxyAgent(''), getProxyAgent())
  const a = getProxyAgent('http://h1:1')
  assert.ok(a)
  assert.equal(getProxyAgent('http://h1:1'), a)
  assert.notEqual(getProxyAgent('http://h2:1'), a)
})

await test('validateProxyUrl', () => {
  assert.equal(validateProxyUrl(''), null)
  assert.equal(validateProxyUrl('http://h:1'), null)
  assert.equal(validateProxyUrl('https://u:p@h:1'), null)
  assert.match(validateProxyUrl('socks5://h:1')!, /SOCKS/)
  assert.ok(validateProxyUrl('not a url'))
  assert.ok(validateProxyUrl('ftp://h'))
  assert.ok(validateProxyUrl('http://' + 'a'.repeat(520)))
})

await test('maskProxyUrl hides the password only', () => {
  const m = maskProxyUrl('http://alice:s3cret@proxy.example:3128')
  assert.ok(!m.includes('s3cret'))
  assert.ok(m.includes('alice') && m.includes('proxy.example:3128') && m.includes('***'))
  assert.equal(maskProxyUrl('http://h:8080'), 'http://h:8080')
  assert.equal(maskProxyUrl(''), '')
})

await test('PATCH sanitizer: proxyUrl must be a string', () => {
  assert.deepEqual(sanitizeAccountPatch({ proxyUrl: ' http://h:1 ' }), { proxyUrl: 'http://h:1' })
  assert.deepEqual(sanitizeAccountPatch({ proxyUrl: '' }), { proxyUrl: '' })
  assert.throws(() => sanitizeAccountPatch({ proxyUrl: 5 }))
})

console.log('\nper-account proxy - routing\n')

await test('refreshOAuthToken with proxyUrl CONNECTs through that proxy', async () => {
  const seen: string[] = []
  const srv = createServer()
  srv.on('connect', (req, socket) => {
    seen.push(req.url || '')
    socket.destroy()
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  await assert.rejects(refreshOAuthToken('rt', `http://127.0.0.1:${port}`))
  srv.close()
  assert.deepEqual(seen, ['platform.claude.com:443'])
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
