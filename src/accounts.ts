import { log } from './logger.js'
import {
  listAccountRows, getAccountRow, insertAccountRow, updateAccountRow,
  deleteAccountRow, listBindingsForAccount,
} from './accounts-store.js'
import type { AccountRow, AccountState } from './accounts-store.js'
import {
  refreshOAuthToken, beginOAuthLogin, completeOAuthLogin,
  OAuthPermanentError, LOGIN_TTL_MS,
} from './oauth-client.js'
import type { OAuthTokens, PendingLogin } from './oauth-client.js'

const FIVE_MINUTES = 5 * 60 * 1000

/** Everything the dashboard may see. Deliberately excludes the tokens. */
export type AccountView = {
  id: string
  label: string
  state: AccountState
  expiresAt: number
  lastError: string
  lastRefreshAt: number
  deviceId: string
  email: string
  env: Record<string, unknown> | null
  promptEnv: Record<string, unknown> | null
  enabled: boolean
  hasRefreshToken: boolean
  loginPending: boolean
  // When the REFRESH token itself expires, if the server told us. In-memory
  // only (mirrors the old oauth.ts module variable) — never persisted to the
  // DB, so it resets on restart.
  refreshTokenExpiresAt: number | null
}

type Runtime = {
  refreshTimer: NodeJS.Timeout | null
  failureCount: number
  refreshTokenExpiresAt: number | null
}

// One runtime slot per account. Timers live here, not in the DB, so a crashed
// refresh on one account can never stall another.
const runtimes = new Map<string, Runtime>()
const pendingLogins = new Map<string, PendingLogin>()
let missingTokenLoggedAt = new Map<string, number>()

function runtimeOf(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { refreshTimer: null, failureCount: 0, refreshTokenExpiresAt: null }
    runtimes.set(id, rt)
  }
  return rt
}

function clearTimerFor(id: string) {
  const rt = runtimes.get(id)
  if (rt?.refreshTimer) {
    clearTimeout(rt.refreshTimer)
    rt.refreshTimer = null
  }
}

function toView(row: AccountRow): AccountView {
  const pending = pendingLogins.get(row.id)
  return {
    id: row.id,
    label: row.label,
    state: row.state,
    expiresAt: row.expiresAt,
    lastError: row.lastError,
    lastRefreshAt: row.lastRefreshAt,
    deviceId: row.deviceId,
    email: row.email,
    env: row.env,
    promptEnv: row.promptEnv,
    enabled: row.enabled,
    hasRefreshToken: row.refreshToken !== '',
    loginPending: pending !== undefined && pending.expiresAt > Date.now(),
    refreshTokenExpiresAt: runtimes.get(row.id)?.refreshTokenExpiresAt ?? null,
  }
}

/** Reset every in-memory timer and pending login. Test helper. */
export function _resetAccountsRuntime(): void {
  for (const id of runtimes.keys()) clearTimerFor(id)
  runtimes.clear()
  pendingLogins.clear()
  missingTokenLoggedAt = new Map()
}

/**
 * Load every enabled account and arm its refresh timer.
 *
 * Never throws: a dead refresh_token parks that ONE account in `expired` and
 * leaves the others running. The gateway must come up regardless so the admin
 * can reach the dashboard and log back in.
 */
export async function initAccounts(): Promise<void> {
  const rows = listAccountRows()
  if (rows.length === 0) {
    log('warn', 'No upstream accounts configured. /v1/* will answer 503.')
    log('warn', '  Add one from the admin dashboard → Accounts → "Add account".')
    return
  }

  // allSettled, not all: initAccounts must never throw even if some unforeseen
  // path inside initOne rejects — the never-throws guarantee has to be
  // structural, not contingent on every internal path staying clean.
  await Promise.allSettled(rows.filter((r) => r.enabled).map((row) => initOne(row)))

  const usable = rows.filter((r) => isUsable(r.id)).length
  log('info', `Accounts ready: ${usable}/${rows.length} usable`)
}

async function initOne(row: AccountRow): Promise<void> {
  const now = Date.now()

  if (row.accessToken && row.expiresAt > now + FIVE_MINUTES) {
    updateAccountRow(row.id, { state: 'ok', lastError: '' })
    scheduleRefresh(row.id, row.expiresAt)
    return
  }

  if (!row.refreshToken) {
    // A row already parked in `expired` (a past permanent failure) stays
    // `expired` — it's still waiting on a re-login, not freshly created.
    // Only a row that never had a refresh_token at all is `uninitialized`.
    if (row.state !== 'expired') {
      updateAccountRow(row.id, { state: 'uninitialized' })
    }
    return
  }

  updateAccountRow(row.id, { state: 'refreshing' })
  await runRefresh(row.id)
}

function scheduleRefresh(id: string, expiresAt: number) {
  clearTimerFor(id)
  const refreshIn = Math.max(expiresAt - Date.now() - FIVE_MINUTES, 10_000)
  runtimeOf(id).refreshTimer = setTimeout(() => {
    // .catch, not void: an uncaught rejection here is an unhandled promise
    // rejection, and Node kills the whole process on those.
    runRefresh(id).catch((err) => {
      log('error', `Account "${id}" refresh crashed: ${err instanceof Error ? err.message : err}`)
    })
  }, refreshIn)
}

async function runRefresh(id: string): Promise<void> {
  clearTimerFor(id)
  const row = getAccountRow(id)
  if (!row || !row.enabled) return
  if (!row.refreshToken) {
    updateAccountRow(id, { state: 'expired', lastError: 'no refresh_token available' })
    return
  }

  try {
    log('info', `Refreshing OAuth token for account "${id}"...`)
    const tokens = await refreshOAuthToken(row.refreshToken)
    persist(id, tokens)
    runtimeOf(id).failureCount = 0
    log('info', `Account "${id}" refreshed, expires at ${new Date(tokens.expiresAt).toISOString()}`)
    scheduleRefresh(id, tokens.expiresAt)
  } catch (err) {
    handleRefreshFailure(id, err)
  }
}

function persist(id: string, tokens: OAuthTokens) {
  // In-memory only, like the rest of Runtime — see the AccountView field doc.
  runtimeOf(id).refreshTokenExpiresAt = tokens.refreshTokenExpiresAt ?? null
  updateAccountRow(id, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    state: 'ok',
    lastError: '',
    lastRefreshAt: Date.now(),
  })
}

/**
 * A permanent failure (invalid_grant) means this account's refresh_token is
 * gone for good — park it in `expired` and stop retrying. Anything else backs
 * off and tries again. Either way, only this account is affected.
 *
 * Both branches guard their own DB write: this runs inside runRefresh's only
 * catch block, so a throw here (e.g. the account was deleted mid-refresh, or
 * a transient DB error like SQLITE_BUSY) would otherwise escape uncaught and
 * take the whole process down — exactly the crash-loop this project exists
 * to eliminate. On a write failure we log and give up on this cycle rather
 * than re-arm a timer for an account that may no longer exist.
 */
function handleRefreshFailure(id: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const rt = runtimeOf(id)
  rt.failureCount++

  if (err instanceof OAuthPermanentError) {
    try {
      updateAccountRow(id, { state: 'expired', lastError: message })
    } catch (writeErr) {
      log('error', `Account "${id}": could not record permanent refresh failure: ${writeErr instanceof Error ? writeErr.message : writeErr}`)
      return
    }
    clearTimerFor(id)
    log('error', `Account "${id}" refresh_token is no longer valid: ${message}`)
    log('error', `  Re-login from the admin dashboard → Accounts → "${id}".`)
    return
  }

  try {
    updateAccountRow(id, { state: 'refreshing', lastError: message })
  } catch (writeErr) {
    log('error', `Account "${id}": could not record refresh failure: ${writeErr instanceof Error ? writeErr.message : writeErr}`)
    return
  }
  // 30s, 60s, 2m, 4m, … capped at 10 minutes.
  const delay = Math.min(30_000 * 2 ** (rt.failureCount - 1), 10 * 60_000)
  log('error', `Account "${id}" refresh failed (attempt ${rt.failureCount}): ${message}. Retrying in ${Math.round(delay / 1000)}s`)
  clearTimerFor(id)
  rt.refreshTimer = setTimeout(() => {
    runRefresh(id).catch((retryErr) => {
      log('error', `Account "${id}" refresh crashed: ${retryErr instanceof Error ? retryErr.message : retryErr}`)
    })
  }, delay)
}

export function listAccounts(): AccountView[] {
  return listAccountRows().map(toView)
}

export function getAccountView(id: string): AccountView | null {
  const row = getAccountRow(id)
  return row ? toView(row) : null
}

export function createAccount(input: {
  id: string
  label?: string
  email?: string
  env?: Record<string, unknown> | null
  promptEnv?: Record<string, unknown> | null
  deviceId?: string
}): AccountView {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.id)) {
    throw new Error('Account id must be 1-64 chars: letters, digits or dashes')
  }
  if (input.deviceId && !/^[0-9a-f]{64}$/i.test(input.deviceId)) {
    throw new Error('deviceId must be exactly 64 hex characters')
  }
  if (getAccountRow(input.id)) {
    throw new Error(`Account "${input.id}" already exists`)
  }
  return toView(insertAccountRow(input))
}

export function updateAccount(
  id: string,
  patch: {
    label?: string
    email?: string
    enabled?: boolean
    env?: Record<string, unknown> | null
    promptEnv?: Record<string, unknown> | null
  },
): AccountView {
  const wasEnabled = getAccountRow(id)?.enabled
  const row = updateAccountRow(id, patch)
  if (patch.enabled === false) clearTimerFor(id)
  if (patch.enabled === true && !wasEnabled) {
    // Re-run the same startup decision initAccounts made: schedule a refresh
    // if the cached token is still good, refresh now if not, or park
    // uninitialized. Without this a re-enabled account keeps serving its
    // cached token with no timer armed, then goes silently, permanently dead
    // the moment that token expires.
    initOne(row).catch((err) => {
      log('error', `Account "${id}": re-enable init failed: ${err instanceof Error ? err.message : err}`)
    })
  }
  return toView(row)
}

/** Refuse while any client still points at it — silently breaking their
 *  routing is worse than making the admin unbind first. */
export function deleteAccount(id: string): void {
  const bindings = listBindingsForAccount(id)
  if (bindings.length > 0) {
    const names = bindings.map((b) => b.clientName).join(', ')
    throw new Error(`Account "${id}" is still used by: ${names}`)
  }
  clearTimerFor(id)
  runtimes.delete(id)
  pendingLogins.delete(id)
  deleteAccountRow(id)
}

export function getAccessTokenFor(id: string): string | null {
  const row = getAccountRow(id)
  if (!row || !row.enabled || !row.accessToken) return null
  if (Date.now() >= row.expiresAt) {
    logMissingToken(id, row.state)
    return null
  }
  return row.accessToken
}

export function isUsable(id: string): boolean {
  return getAccessTokenFor(id) !== null
}

/** Throttled per account so a burst of proxied requests can't flood the log. */
function logMissingToken(id: string, state: AccountState) {
  const now = Date.now()
  const last = missingTokenLoggedAt.get(id) || 0
  if (now - last < 30_000) return
  missingTokenLoggedAt.set(id, now)
  if (state === 'expired') {
    log('warn', `Account "${id}": refresh_token expired — re-login from the admin dashboard`)
  } else {
    log('warn', `Account "${id}": no access token available, waiting for refresh...`)
  }
}

export function beginLogin(id: string): { url: string; expires_in_ms: number } {
  if (!getAccountRow(id)) throw new Error(`No such account: ${id}`)
  const { url, pending, expiresInMs } = beginOAuthLogin()
  pendingLogins.set(id, pending)
  return { url, expires_in_ms: expiresInMs }
}

export function cancelLogin(id: string): void {
  pendingLogins.delete(id)
}

export async function completeLogin(
  id: string,
  pasted: string,
): Promise<{ expires_at: number }> {
  const pending = pendingLogins.get(id)
  if (!pending) throw new Error('No login in progress — start a new one')
  if (pending.expiresAt <= Date.now()) {
    pendingLogins.delete(id)
    throw new Error('Login request expired — start a new one')
  }

  const tokens = await completeOAuthLogin(pasted, pending)
  pendingLogins.delete(id)
  runtimeOf(id).failureCount = 0
  persist(id, tokens)
  scheduleRefresh(id, tokens.expiresAt)
  log('info', `Account "${id}" logged in, token expires at ${new Date(tokens.expiresAt).toISOString()}`)
  return { expires_at: tokens.expiresAt }
}

export { LOGIN_TTL_MS }
