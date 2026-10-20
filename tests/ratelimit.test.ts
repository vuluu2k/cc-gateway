import {
  captureRateLimitHeaders,
  getRateLimitSnapshots,
  _resetRateLimitSnapshot,
} from '../src/ratelimit.js'
import { strict as assert } from 'assert'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  _resetRateLimitSnapshot()
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

const FIVE_H = 5 * 60 * 60 * 1000
// A representative unified-header set as Anthropic returns for a subscription
// (OAuth) account on every /v1/messages response.
const sampleHeaders = () => ({
  'content-type': 'text/event-stream',
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-reset': '1764554400',
  'anthropic-ratelimit-unified-5h-utilization': '0.018',
  'anthropic-ratelimit-unified-7d-status': 'allowed_warning',
  'anthropic-ratelimit-unified-7d-reset': '1764615600',
  'anthropic-ratelimit-unified-7d-utilization': '0.737',
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
})

console.log('\ncaptureRateLimitHeaders - unified quota parsing\n')

test('parses 5h and 7d windows with utilization → usedPct', () => {
  captureRateLimitHeaders('acc-a', sampleHeaders())
  const snap = getRateLimitSnapshots()['acc-a']
  assert.ok(snap)
  const w5 = snap!.windows.find((w) => w.key === '5h')
  const w7 = snap!.windows.find((w) => w.key === '7d')
  assert.ok(w5 && w7)
  assert.equal(Math.round(w5!.usedPct!), 2) // 0.018 → 1.8%
  assert.equal(Math.round(w7!.usedPct! * 10) / 10, 73.7)
  assert.equal(w5!.status, 'allowed')
  assert.equal(w7!.status, 'allowed_warning')
})

test('reset seconds are converted to epoch ms', () => {
  captureRateLimitHeaders('acc-a', sampleHeaders())
  const w5 = getRateLimitSnapshots()['acc-a']!.windows.find((w) => w.key === '5h')!
  assert.equal(w5.resetMs, 1764554400 * 1000)
})

test('sessionWindowStartMs = 5h reset − 5h', () => {
  captureRateLimitHeaders('acc-a', sampleHeaders())
  const snap = getRateLimitSnapshots()['acc-a']!
  assert.equal(snap.sessionWindowStartMs, 1764554400 * 1000 - FIVE_H)
})

test('captures overall status and representative claim', () => {
  captureRateLimitHeaders('acc-a', sampleHeaders())
  const snap = getRateLimitSnapshots()['acc-a']!
  assert.equal(snap.overallStatus, 'allowed')
  assert.equal(snap.representative, 'five_hour')
})

test('utilization is clamped to 0–100', () => {
  captureRateLimitHeaders('acc-a', {
    'anthropic-ratelimit-unified-5h-utilization': '1.5',
    'anthropic-ratelimit-unified-7d-utilization': '-0.2',
  })
  const snap = getRateLimitSnapshots()['acc-a']!
  assert.equal(snap.windows.find((w) => w.key === '5h')!.usedPct, 100)
  assert.equal(snap.windows.find((w) => w.key === '7d')!.usedPct, 0)
})

test('raw holds every anthropic-ratelimit-* header, lowercased', () => {
  captureRateLimitHeaders('acc-a', {
    'Anthropic-RateLimit-Unified-5h-Status': 'allowed',
    'x-other': 'ignored',
  })
  const raw = getRateLimitSnapshots()['acc-a']!.raw
  assert.equal(raw['anthropic-ratelimit-unified-5h-status'], 'allowed')
  assert.equal(raw['x-other'], undefined)
})

test('array-valued headers are joined', () => {
  captureRateLimitHeaders('acc-a', {
    'anthropic-ratelimit-unified-5h-status': ['allowed', 'extra'],
  })
  assert.equal(
    getRateLimitSnapshots()['acc-a']!.raw['anthropic-ratelimit-unified-5h-status'],
    'allowed, extra',
  )
})

test('no-op when response carries no rate-limit headers', () => {
  captureRateLimitHeaders('acc-a', { 'content-type': 'application/json' })
  assert.equal(getRateLimitSnapshots()['acc-a'], undefined)
})

test('a window with only a status (no utilization/reset) still appears', () => {
  captureRateLimitHeaders('acc-a', { 'anthropic-ratelimit-unified-5h-status': 'rejected' })
  const w5 = getRateLimitSnapshots()['acc-a']!.windows.find((w) => w.key === '5h')!
  assert.equal(w5.status, 'rejected')
  assert.equal(w5.usedPct, undefined)
  assert.equal(w5.resetMs, undefined)
})

test('snapshots are kept per account, not overwritten by another account', () => {
  captureRateLimitHeaders('acc-a', sampleHeaders())
  captureRateLimitHeaders('acc-b', { 'anthropic-ratelimit-unified-5h-utilization': '0.5' })
  const all = getRateLimitSnapshots()
  assert.deepEqual(Object.keys(all).sort(), ['acc-a', 'acc-b'])
  assert.equal(Math.round(all['acc-a'].windows.find((w) => w.key === '5h')!.usedPct!), 2)
  assert.equal(all['acc-b'].windows.find((w) => w.key === '5h')!.usedPct, 50)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
