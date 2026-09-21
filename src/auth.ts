import type { IncomingMessage } from 'http'
import { listClientRows } from './accounts-store.js'

export type ClientEntry = {
  name: string
  token: string
  homeDir: string
}

const tokenMap = new Map<string, ClientEntry>()

/**
 * Rebuild the token → client map from the DB.
 *
 * Clients used to live in config.yaml and were picked up by a 2-second
 * watchFile poll. They are rows now, so every mutating endpoint calls this
 * directly and changes take effect on the next request.
 */
export function reloadClients(): void {
  tokenMap.clear()
  for (const row of listClientRows()) {
    tokenMap.set(row.token, { name: row.name, token: row.token, homeDir: row.homeDir })
  }
}

/** Look up a client by its raw token (used by the self-service portal login). */
export function lookupToken(token: string): ClientEntry | null {
  if (!token) return null
  return tokenMap.get(token) ?? null
}

/**
 * Authenticate incoming request by Bearer token.
 * Returns the matched client or null.
 */
export function authenticate(req: IncomingMessage): ClientEntry | null {
  // CC with ANTHROPIC_API_KEY sends x-api-key header
  const apiKey = req.headers['x-api-key']
  if (apiKey && typeof apiKey === 'string') {
    const entry = tokenMap.get(apiKey)
    if (entry) return entry
  }

  // Bearer token in Authorization or Proxy-Authorization
  const authHeader = req.headers['proxy-authorization'] || req.headers['authorization']
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) {
      const entry = tokenMap.get(match[1])
      if (entry) return entry
    }
  }

  return null
}
