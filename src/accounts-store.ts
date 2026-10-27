import { randomBytes } from 'crypto'
import { getDb } from './db.js'

export type AccountState = 'uninitialized' | 'ok' | 'refreshing' | 'expired'
export type LimitPeriod = 'lifetime' | 'monthly' | 'daily'

export type AccountRow = {
  id: string
  label: string
  refreshToken: string
  accessToken: string
  expiresAt: number
  state: AccountState
  lastError: string
  lastRefreshAt: number
  deviceId: string
  email: string
  env: Record<string, unknown> | null
  promptEnv: Record<string, unknown> | null
  enabled: boolean
  proxyUrl: string
  // Lowercase. A model matches when its id contains any entry ("opus" blocks
  // every Opus); an effort matches exactly. Routing skips accounts that match.
  blockedModels: string[]
  blockedEfforts: string[]
  createdAt: number
}

export type ClientRow = {
  name: string
  token: string
  homeDir: string
  createdAt: number
}

export type BindingRow = {
  clientName: string
  accountId: string
  priority: number
  limitUsd: number
  limitPeriod: LimitPeriod
}

type RawAccount = {
  id: string; label: string; refresh_token: string; access_token: string
  expires_at: number; state: string; last_error: string; last_refresh_at: number
  device_id: string; email: string; env_json: string; prompt_env_json: string
  enabled: number; proxy_url: string; blocked_models: string; blocked_efforts: string
  created_at: number
}

const splitList = (raw: string): string[] => (raw ? raw.split(',') : [])

/** Parse a stored JSON column. An empty or malformed value means "inherit". */
function parseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function toAccount(r: RawAccount): AccountRow {
  return {
    id: r.id,
    label: r.label,
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    expiresAt: r.expires_at,
    state: r.state as AccountState,
    lastError: r.last_error,
    lastRefreshAt: r.last_refresh_at,
    deviceId: r.device_id,
    email: r.email,
    env: parseJson(r.env_json),
    promptEnv: parseJson(r.prompt_env_json),
    enabled: r.enabled === 1,
    proxyUrl: r.proxy_url,
    blockedModels: splitList(r.blocked_models),
    blockedEfforts: splitList(r.blocked_efforts),
    createdAt: r.created_at,
  }
}

export function generateDeviceId(): string {
  return randomBytes(32).toString('hex')
}

export function listAccountRows(): AccountRow[] {
  return (getDb()
    .prepare('SELECT * FROM accounts ORDER BY created_at ASC, id ASC')
    .all() as RawAccount[]).map(toAccount)
}

export function getAccountRow(id: string): AccountRow | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | RawAccount
    | undefined
  return row ? toAccount(row) : null
}

export function insertAccountRow(input: {
  id: string
  label?: string
  deviceId?: string
  email?: string
  env?: Record<string, unknown> | null
  promptEnv?: Record<string, unknown> | null
  proxyUrl?: string
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
}): AccountRow {
  getDb()
    .prepare(
      `INSERT INTO accounts (
        id, label, refresh_token, access_token, expires_at,
        device_id, email, env_json, prompt_env_json, proxy_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.label || '',
      input.refreshToken || '',
      input.accessToken || '',
      input.expiresAt || 0,
      input.deviceId || generateDeviceId(),
      input.email || '',
      input.env ? JSON.stringify(input.env) : '',
      input.promptEnv ? JSON.stringify(input.promptEnv) : '',
      input.proxyUrl || '',
      Date.now(),
    )
  return getAccountRow(input.id)!
}

const ACCOUNT_COLUMNS: Record<string, string> = {
  label: 'label',
  refreshToken: 'refresh_token',
  accessToken: 'access_token',
  expiresAt: 'expires_at',
  state: 'state',
  lastError: 'last_error',
  lastRefreshAt: 'last_refresh_at',
  deviceId: 'device_id',
  email: 'email',
  enabled: 'enabled',
  proxyUrl: 'proxy_url',
}

export function updateAccountRow(
  id: string,
  patch: Partial<Omit<AccountRow, 'id' | 'createdAt'>>,
): AccountRow {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(ACCOUNT_COLUMNS)) {
    if (!(key in patch)) continue
    const value = (patch as Record<string, unknown>)[key]
    sets.push(`${column} = ?`)
    values.push(key === 'enabled' ? (value ? 1 : 0) : value)
  }
  if ('env' in patch) {
    sets.push('env_json = ?')
    values.push(patch.env ? JSON.stringify(patch.env) : '')
  }
  if ('promptEnv' in patch) {
    sets.push('prompt_env_json = ?')
    values.push(patch.promptEnv ? JSON.stringify(patch.promptEnv) : '')
  }
  if (patch.blockedModels) {
    sets.push('blocked_models = ?')
    values.push(patch.blockedModels.join(','))
  }
  if (patch.blockedEfforts) {
    sets.push('blocked_efforts = ?')
    values.push(patch.blockedEfforts.join(','))
  }

  if (sets.length > 0) {
    values.push(id)
    getDb().prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  const row = getAccountRow(id)
  if (!row) throw new Error(`No such account: ${id}`)
  return row
}

export function deleteAccountRow(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

export function listClientRows(): ClientRow[] {
  return (getDb()
    .prepare('SELECT * FROM clients ORDER BY name ASC')
    .all() as Array<{ name: string; token: string; home_dir: string; created_at: number }>).map(
    (r) => ({ name: r.name, token: r.token, homeDir: r.home_dir, createdAt: r.created_at }),
  )
}

export function getClientRow(name: string): ClientRow | null {
  const r = getDb().prepare('SELECT * FROM clients WHERE name = ?').get(name) as
    | { name: string; token: string; home_dir: string; created_at: number }
    | undefined
  return r ? { name: r.name, token: r.token, homeDir: r.home_dir, createdAt: r.created_at } : null
}

export function insertClientRow(input: {
  name: string
  token: string
  homeDir?: string
}): ClientRow {
  getDb()
    .prepare('INSERT INTO clients (name, token, home_dir, created_at) VALUES (?, ?, ?, ?)')
    .run(input.name, input.token, input.homeDir || '', Date.now())
  return getClientRow(input.name)!
}

export function deleteClientRow(name: string): void {
  getDb().prepare('DELETE FROM clients WHERE name = ?').run(name)
}

function toBinding(r: {
  client_name: string; account_id: string
  priority: number; limit_usd: number; limit_period: string
}): BindingRow {
  return {
    clientName: r.client_name,
    accountId: r.account_id,
    priority: r.priority,
    limitUsd: r.limit_usd,
    limitPeriod: r.limit_period as LimitPeriod,
  }
}

export function listBindings(clientName: string): BindingRow[] {
  return (getDb()
    .prepare(
      'SELECT * FROM client_accounts WHERE client_name = ? ORDER BY priority ASC, account_id ASC',
    )
    .all(clientName) as Parameters<typeof toBinding>[0][]).map(toBinding)
}

export function listBindingsForAccount(accountId: string): BindingRow[] {
  return (getDb()
    .prepare('SELECT * FROM client_accounts WHERE account_id = ? ORDER BY client_name ASC')
    .all(accountId) as Parameters<typeof toBinding>[0][]).map(toBinding)
}

/**
 * Swap a client's whole binding set in one transaction. Replacing the array
 * wholesale keeps the UI simple and rules out half-applied states that a
 * per-row CRUD surface would allow.
 */
export function replaceBindings(
  clientName: string,
  rows: Array<Omit<BindingRow, 'clientName'>>,
): void {
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare('DELETE FROM client_accounts WHERE client_name = ?').run(clientName)
    const insert = db.prepare(
      `INSERT INTO client_accounts (client_name, account_id, priority, limit_usd, limit_period)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const row of rows) {
      insert.run(clientName, row.accountId, row.priority, row.limitUsd, row.limitPeriod)
    }
  })
  run()
}
