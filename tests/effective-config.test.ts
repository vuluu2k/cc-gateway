import { strict as assert } from 'assert'
import { effectiveConfigFor } from '../src/effective-config.js'
import type { Config } from '../src/config.js'
import type { AccountRow } from '../src/accounts-store.js'

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

const base = {
  upstream: { url: 'https://api.anthropic.com' },
  identity: { device_id: 'ba'.repeat(32), email: 'base@example.com' },
  env: { platform: 'darwin', arch: 'arm64', terminal: 'iTerm2.app' },
  prompt_env: { platform: 'darwin', shell: 'zsh', os_version: 'Darwin 24.4.0', working_dir: '/Users/dev' },
} as unknown as Config

function account(patch: Partial<AccountRow>): AccountRow {
  return {
    id: 'acc', label: '', refreshToken: '', accessToken: '', expiresAt: 0,
    state: 'ok', lastError: '', lastRefreshAt: 0,
    deviceId: 'aa'.repeat(32), email: 'acc@example.com',
    env: null, promptEnv: null, enabled: true, createdAt: 0,
    ...patch,
  }
}

console.log('\neffective-config\n')

test('device_id và email lấy từ account', () => {
  const cfg = effectiveConfigFor(base, account({}))
  assert.equal(cfg.identity.device_id, 'aa'.repeat(32))
  assert.equal(cfg.identity.email, 'acc@example.com')
})

test('env rỗng thì kế thừa config gốc', () => {
  const cfg = effectiveConfigFor(base, account({ env: null }))
  assert.deepEqual(cfg.env, base.env)
  assert.deepEqual(cfg.prompt_env, base.prompt_env)
})

test('env của account ghi đè theo từng khoá, không thay cả khối', () => {
  const cfg = effectiveConfigFor(base, account({ env: { terminal: 'Apple_Terminal' } }))
  assert.equal(cfg.env.terminal, 'Apple_Terminal')
  assert.equal(cfg.env.platform, 'darwin')
  assert.equal(cfg.env.arch, 'arm64')
})

test('prompt_env của account ghi đè theo từng khoá', () => {
  const cfg = effectiveConfigFor(base, account({ promptEnv: { shell: 'bash' } }))
  assert.equal(cfg.prompt_env.shell, 'bash')
  assert.equal(cfg.prompt_env.working_dir, '/Users/dev')
})

test('không làm bẩn config gốc', () => {
  effectiveConfigFor(base, account({ env: { terminal: 'X' } }))
  assert.equal(base.identity.device_id, 'ba'.repeat(32))
  assert.equal(base.env.terminal, 'iTerm2.app')
})

test('email rỗng của account thì giữ email gốc', () => {
  const cfg = effectiveConfigFor(base, account({ email: '' }))
  assert.equal(cfg.identity.email, 'base@example.com')
})

test('deviceId rỗng của account thì giữ deviceId gốc', () => {
  const cfg = effectiveConfigFor(base, account({ deviceId: '' }))
  assert.equal(cfg.identity.device_id, 'ba'.repeat(32))
})

test('hai account cho ra hai config khác nhau', () => {
  const a = effectiveConfigFor(base, account({ deviceId: '11'.repeat(32) }))
  const b = effectiveConfigFor(base, account({ deviceId: '22'.repeat(32) }))
  assert.notEqual(a.identity.device_id, b.identity.device_id)
  assert.equal(a.upstream.url, b.upstream.url)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
