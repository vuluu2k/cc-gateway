import { getDb } from './db.js'
import { insertAccountRow, insertClientRow, replaceBindings } from './accounts-store.js'
import type { LimitPeriod } from './accounts-store.js'
import type { Config } from './config.js'
import { log } from './logger.js'

const LEGACY_ACCOUNT_ID = 'default'

/**
 * One-way import of a single-account config.yaml into the multi-account tables.
 *
 * Runs only when the accounts table is empty AND the config still carries an
 * oauth.refresh_token — so it fires exactly once, on the first start after the
 * upgrade, and never touches a gateway that was set up through the dashboard.
 *
 * Observable behaviour after the import is identical to before it: one account,
 * the same clients, the same cost limits.
 *
 * Returns true when it imported something.
 */
export function migrateFromConfig(config: Config): boolean {
  const db = getDb()

  const existing = db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
  if (existing.n > 0) return false

  const refreshToken = config.oauth?.refresh_token
  if (!refreshToken) return false

  const tokens = config.auth?.tokens || []

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
    for (const entry of tokens) {
      // A hand-edited config.yaml can carry the same client twice. Skipping the
      // duplicate keeps the gateway bootable; throwing here would crash-loop the
      // container with the admin locked out of the dashboard.
      if (!entry.name || seen.has(entry.name)) {
        log('warn', `Migration: skipping duplicate or unnamed client "${entry.name}"`)
        continue
      }
      seen.add(entry.name)
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
  })
  run()

  log('info', `Migrated config.yaml to multi-account: 1 account, ${tokens.length} clients`)
  return true
}
