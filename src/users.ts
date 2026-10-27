import { randomBytes, timingSafeEqual } from 'crypto'
import { getDb, getOrCreateMeta } from './db.js'
import { hashPassword, verifyPassword, dummyHash } from './password.js'

export interface User {
  id: number
  username: string
  password_hash: string
  created_at: number
}

export function createUser(username: string, password: string): User {
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new Error('username must be 3-32 chars, [a-zA-Z0-9_.-]')
  }
  if (password.length < 8) {
    throw new Error('password must be at least 8 characters')
  }
  const db = getDb()
  const hash = hashPassword(password)
  const now = Date.now()
  const result = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, now)
  return { id: Number(result.lastInsertRowid), username, password_hash: hash, created_at: now }
}

export function findUser(username: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined
  return row ?? null
}

export function authenticateUser(username: string, password: string): User | null {
  const user = findUser(username)
  if (!user) {
    // Constant-time-ish: still run a hash to avoid leaking existence via timing
    dummyHash(password)
    return null
  }
  return verifyPassword(password, user.password_hash) ? user : null
}

export function countUsers(): number {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }
  return row.c
}

const SETUP_CODE_TTL_MS = 24 * 60 * 60 * 1000

function newSetupCodeRecord(): string {
  return `${randomBytes(16).toString('hex')}:${Date.now() + SETUP_CODE_TTL_MS}`
}

/**
 * A one-time code that lets the very first admin account be created through the
 * browser. Without it, a gateway with no users would have no way in — and the
 * docker-only setup path has no shell to run add-user from. Only exists while
 * there are zero users; expires after 24h (a fresh one is issued on demand).
 */
export function currentSetupCode(): string | null {
  if (countUsers() > 0) return null
  let stored = getOrCreateMeta('setup_code', newSetupCodeRecord)
  if (Number(stored.split(':')[1]) <= Date.now()) {
    stored = newSetupCodeRecord()
    getDb().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('setup_code', ?)`).run(stored)
  }
  return stored.split(':')[0]
}

/** Constant-time check, does not consume the code. */
export function checkSetupCode(code: string): boolean {
  const expected = currentSetupCode()
  if (!expected || !code) return false
  const a = Buffer.from(code)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function clearSetupCode(): void {
  getDb().prepare(`DELETE FROM meta WHERE key = 'setup_code'`).run()
}

export function consumeSetupCode(code: string): boolean {
  if (!checkSetupCode(code)) return false
  clearSetupCode()
  return true
}
