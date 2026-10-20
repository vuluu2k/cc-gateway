import { watchFile } from 'fs'
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { setLogLevel, log } from './logger.js'
import { initAccounts } from './accounts.js'
import { startProxy } from './proxy.js'
import { initDb } from './db.js'
import { initMetrics } from './metrics.js'
import { currentSetupCode } from './users.js'
import { migrateFromConfig } from './migrate-accounts.js'
import { reloadClients } from './auth.js'
import {
  bootstrapConfigIfMissing,
  syncOAuthFromCredentialsIfChanged,
  seedAccountFromEnvIfEmpty,
} from './bootstrap-config.js'
import { syncClaudeCodeVersion, startDailyVersionAutoUpdate } from './cc-version.js'

// Resolve the config path: explicit arg > CCG_CONFIG_PATH env > /app/data/config.yaml.
// /app/data is the persistent volume so the auto-generated config survives restarts.
const configPath =
  process.argv[2] ||
  process.env.CCG_CONFIG_PATH ||
  '/app/data/config.yaml'

try {
  if (!bootstrapConfigIfMissing(configPath)) {
    process.exit(1)
  }

  // If a credentials.json is mounted and its refresh_token differs from the
  // one persisted in config.yaml (e.g. host did `claude` and rotated the
  // token), refresh the config before we load it.
  syncOAuthFromCredentialsIfChanged(configPath)

  const config = loadConfig(configPath)
  setLogLevel(config.logging.level)

  log('info', 'CC Gateway starting...')
  log('info', `Config: ${resolve(configPath)}`)

  // On every deploy/start, sync the spoofed Claude Code version to the latest
  // released CLI so the forwarded user-agent + cc_version stay current. Opt out
  // with CCG_DISABLE_VERSION_AUTOUPDATE=1. Best-effort — never blocks startup.
  if (process.env.CCG_DISABLE_VERSION_AUTOUPDATE !== '1') {
    await syncClaudeCodeVersion(configPath, config)
    startDailyVersionAutoUpdate(configPath, config)
  }

  const dbPath = config.db?.path || './data/ccg.db'
  initDb(dbPath)
  initMetrics()
  log('info', `SQLite database: ${resolve(dbPath)}`)

  // Two seeding paths, both guarded on "accounts table is empty", so at most
  // one of them ever runs:
  //   1. an existing single-account config.yaml is imported, or
  //   2. a fresh server is seeded from env/credentials.
  // Neither is required — an empty gateway boots fine and is set up from the web.
  migrateFromConfig(config)
  seedAccountFromEnvIfEmpty(config)

  reloadClients()
  // Initialize every upstream account — each gets its own refresh timer. Never
  // throws: a dead refresh_token parks THAT account in `expired` and leaves
  // the others running, so the admin always has the dashboard to re-login.
  await initAccounts()

  const setupCode = currentSetupCode()
  if (setupCode) {
    log('warn', '─────────────────────────────────────────────')
    log('warn', `First-time setup code: ${setupCode}`)
    log('warn', '  Open https://<your-domain>/admin and use it to create the admin account.')
    log('warn', '─────────────────────────────────────────────')
  }

  startProxy(config)

  // Hot-reload env.version on config changes (poll-based — works with bind
  // mounts). This lets an external cron / manual edit to config.yaml take
  // effect live without restarting the gateway. Clients no longer live in
  // config.yaml (they're DB rows — see src/auth.ts), so this poll only
  // syncs env.version now.
  const watchPath = resolve(configPath)
  watchFile(watchPath, { interval: 2000 }, () => {
    try {
      const next = loadConfig(configPath)
      const nextVersion = String(next.env.version || '')
      if (nextVersion && nextVersion !== String(config.env.version || '')) {
        config.env.version = nextVersion
        config.env.version_base = String(next.env.version_base || nextVersion)
        log('info', `Reloaded Claude Code version: ${nextVersion}`)
      }
    } catch (err) {
      log('error', `Config reload failed: ${err instanceof Error ? err.message : err}`)
    }
  })
} catch (err) {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
