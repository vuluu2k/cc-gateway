import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Agent } from 'https'
import { log } from './logger.js'

let agent: Agent | null = null

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy

if (proxyUrl) {
  agent = new HttpsProxyAgent(proxyUrl)
  log('info', `Using proxy: ${maskProxyUrl(proxyUrl)}`)
}

// One agent per distinct per-account proxy URL, so keep-alive sockets are
// reused. ponytail: entries are never evicted; bounded by the number of
// distinct URLs an admin has ever set, which is tiny.
const accountAgents = new Map<string, Agent>()

/** Agent for one account's proxy; falls back to the global env proxy (or null). */
export function getProxyAgent(accountProxyUrl?: string): Agent | null {
  if (!accountProxyUrl) return agent
  let a = accountAgents.get(accountProxyUrl)
  if (!a) {
    a = new HttpsProxyAgent(accountProxyUrl)
    accountAgents.set(accountProxyUrl, a)
  }
  return a
}

/** Replace the password in a proxy URL with ***. Unparseable input is fully hidden. */
export function maskProxyUrl(raw: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.password) u.password = '***'
    return u.toString().replace(/\/$/, '')
  } catch {
    return '***'
  }
}

/** Returns an error message, or null when the value is acceptable ('' = clear). */
export function validateProxyUrl(raw: string): string | null {
  if (raw === '') return null
  if (raw.length > 512) return 'proxyUrl must be at most 512 characters'
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'proxyUrl is not a valid URL'
  }
  if (u.protocol.startsWith('socks')) return 'SOCKS proxies are not supported; use an http:// or https:// proxy'
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'proxyUrl must start with http:// or https://'
  if (!u.hostname) return 'proxyUrl must include a host'
  return null
}
