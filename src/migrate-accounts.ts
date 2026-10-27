import { getDb } from './db.js'
import { insertAccountRow, insertClientRow, replaceBindings } from './accounts-store.js'
import type { LimitPeriod } from './accounts-store.js'
import type { Config } from './config.js'
import { log } from './logger.js'

const LEGACY_ACCOUNT_ID = 'default'

const SEEDED_KEY = 'accounts_seeded'

/**
 * True once this database has ever held an account (imported, env-seeded, or
 * created from the dashboard and seen at a later boot). Both boot-time seeders
 * check it, so deleting every account and restarting cannot bring the
 * migrated/seeded one back - with its old client tokens and a stale
 * refresh_token - nor crash-loop on clients that still exist.
 *
 * `migrated_multi_account` is read too: databases migrated before this flag
 * existed carry only that key.
 */
export function accountSeedingClosed(): boolean {
  const db = getDb()
  const flag = db
    .prepare(`SELECT 1 FROM meta WHERE key IN ('migrated_multi_account', ?)`)
    .get(SEEDED_KEY)
  if (flag) return true
  const existing = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
  if (existing.n === 0) return false
  markAccountsSeeded()
  return true
}

export function markAccountsSeeded(): void {
  getDb().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')`).run(SEEDED_KEY)
}

/**
 * One-way import of a single-account config.yaml into the multi-account tables.
 *
 * Runs only when this database has never held an account (see
 * accountSeedingClosed) AND the config still carries an oauth.refresh_token -
 * so it fires exactly once, on the first start after the upgrade, and never
 * touches a gateway that was set up through the dashboard.
 *
 * Observable behaviour after the import is identical to before it: one account,
 * the same clients, the same cost limits.
 *
 * Returns true when it imported something.
 */
export function migrateFromConfig(config: Config): boolean {
  const db = getDb()

  if (accountSeedingClosed()) return false

  const refreshToken = config.oauth?.refresh_token
  if (!refreshToken) return false

  const tokens = config.auth?.tokens || []

  let imported = 0
  const run = db.transaction(() => {
    insertAccountRow({
      id: LEGACY_ACCOUNT_ID,
      label: 'Migrated',
      refreshToken,
      accessToken: config.oauth?.access_token || '',
      expiresAt: config.oauth?.expires_at || 0,
      deviceId: config.identity?.device_id,
      email: config.identity?.email || '',
    })

    const seen = new Set<string>()
    const seenTokens = new Set<string>()
    for (const entry of tokens) {
      // A hand-edited config.yaml can carry the same client (or the same token
      // under two names) twice. Skipping the duplicate keeps the import whole;
      // clients.token is UNIQUE, so inserting it would abort the transaction.
      if (!entry.name || seen.has(entry.name) || seenTokens.has(entry.token)) {
        log('warn', `Migration: skipping duplicate or unnamed client "${entry.name}"`)
        continue
      }
      seen.add(entry.name)
      seenTokens.add(entry.token)
      imported++
      insertClientRow({ name: entry.name, token: entry.token, homeDir: entry.home_dir })
      replaceBindings(entry.name, [
        {
          accountId: LEGACY_ACCOUNT_ID,
          priority: 0,
          limitUsd: entry.cost_limit_usd || 0,
          limitPeriod: (entry.cost_limit_period || 'lifetime') as LimitPeriod,
        },
      ])
    }

    db.prepare(`UPDATE request_metrics SET account_id = ? WHERE account_id = ''`).run(
      LEGACY_ACCOUNT_ID,
    )
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_multi_account', '1')`).run()
    markAccountsSeeded()
  })
  run()

  log('info', `Migrated config.yaml to multi-account: 1 account, ${imported} clients`)
  return true
}
