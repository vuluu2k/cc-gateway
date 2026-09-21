import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { resolve } from 'path'

export type CostLimitPeriod = 'lifetime' | 'monthly' | 'daily'

export type TokenEntry = {
  name: string
  token: string
  // Optional cost cap (USD). 0 / undefined = unlimited.
  cost_limit_usd?: number
  // Window the cap applies to. Defaults to 'lifetime'.
  cost_limit_period?: CostLimitPeriod
  // This client's REAL home directory, in its native form:
  //   macOS   /Users/alice        Linux  /home/alice        Windows  C:\Users\alice
  // Used to reverse the canonical working_dir back to the client's real path in
  // the model's response (so bash/file tool calls hit real paths) deterministically,
  // instead of re-guessing it from each request's env block. Empty = auto-detect.
  home_dir?: string
}

export type Config = {
  server: {
    port: number
    tls: {
      cert: string
      key: string
    }
  }
  upstream: {
    url: string
  }
  auth?: {
    tokens: TokenEntry[]
  }
  oauth?: {
    access_token?: string
    refresh_token: string
    expires_at?: number
  }
  identity: {
    device_id: string
    email: string
  }
  env: Record<string, string | boolean | number>
  // System prompt environment masking - must be consistent with env above
  prompt_env: {
    platform: string        // "darwin" — must match env.platform
    shell: string           // "zsh"
    os_version: string      // "Darwin 24.4.0" — uname -sr output
    working_dir: string     // "/Users/dev/projects" — canonical home path prefix
    // Reverse the masked cwd/home paths back to the real ones in the model's
    // response stream, so bash/file tool calls work despite request masking.
    // Defaults to on; set false to disable (response passes through untouched).
    reverse_paths?: boolean
  }
  process: {
    constrained_memory: number
    rss_range: [number, number]
    heap_total_range: [number, number]
    heap_used_range: [number, number]
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    audit: boolean
  }
  db?: {
    path: string
  }
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || resolve(process.cwd(), 'config.yaml')
  const raw = readFileSync(filePath, 'utf-8')
  const config = parse(raw) as Config

  // identity/env/prompt_env are now DEFAULTS stamped onto newly created
  // accounts, not the live fingerprint - so a placeholder device_id is no
  // longer fatal. Accounts carry the real one (see src/accounts-store.ts).
  // auth.tokens and oauth are read once by the migration and never again.
  return config
}
