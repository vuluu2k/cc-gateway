import { strict as assert } from 'assert'
import { parsePastedCode, beginOAuthLogin, LOGIN_TTL_MS } from '../src/oauth-client.js'

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

console.log('\noauth-client - parsePastedCode\n')

test('bare code', () => {
  assert.deepEqual(parsePastedCode('abc123'), { code: 'abc123', state: null })
})

test('code#state form', () => {
  assert.deepEqual(parsePastedCode('abc123#st-9'), { code: 'abc123', state: 'st-9' })
})

test('code= prefix', () => {
  assert.deepEqual(parsePastedCode('code=abc123#st-9'), { code: 'abc123', state: 'st-9' })
})

test('full redirect URL', () => {
  const url = 'https://platform.claude.com/oauth/code/callback?code=abc123&state=st-9'
  assert.deepEqual(parsePastedCode(url), { code: 'abc123', state: 'st-9' })
})

test('trims surrounding whitespace', () => {
  assert.deepEqual(parsePastedCode('  abc123#st-9  '), { code: 'abc123', state: 'st-9' })
})

console.log('\noauth-client - beginOAuthLogin\n')

test('returns independent pending state per call', () => {
  const a = beginOAuthLogin()
  const b = beginOAuthLogin()
  assert.notEqual(a.pending.verifier, b.pending.verifier)
  assert.notEqual(a.pending.state, b.pending.state)
  assert.equal(a.expiresInMs, LOGIN_TTL_MS)
})

test('URL carries all PKCE parameters', () => {
  const { url, pending } = beginOAuthLogin()
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('response_type'), 'code')
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(parsed.searchParams.get('state'), pending.state)
  assert.ok(parsed.searchParams.get('code_challenge'))
  // the challenge must be the hash, never the raw verifier
  assert.notEqual(parsed.searchParams.get('code_challenge'), pending.verifier)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
