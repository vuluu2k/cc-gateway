import type { Config } from './config.js'
import type { AccountRow } from './accounts-store.js'

/**
 * Build the Config that rewriting should use for one request.
 *
 * rewriter.ts threads `config: Config` through sixteen functions. Rather than
 * adding an account parameter to every one of them, we hand it a shallow clone
 * whose identity/env/prompt_env belong to the chosen account. The rewriter stays
 * untouched and keeps working on a plain Config.
 *
 * An account's env/prompt_env overlay the defaults key by key, so an account
 * only has to state what differs (say, a different terminal) instead of
 * restating the whole fingerprint.
 */
export function effectiveConfigFor(base: Config, account: AccountRow): Config {
  return {
    ...base,
    identity: {
      device_id: account.deviceId || base.identity.device_id,
      email: account.email || base.identity.email,
    },
    env: account.env ? { ...base.env, ...account.env } : base.env,
    prompt_env: account.promptEnv
      ? { ...base.prompt_env, ...account.promptEnv }
      : base.prompt_env,
  } as Config
}
