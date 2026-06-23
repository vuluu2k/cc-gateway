import { createHash, randomBytes } from 'crypto'
import { StringDecoder } from 'string_decoder'
import type { Config } from './config.js'
import { log } from './logger.js'

export type PathPair = { from: string; to: string }

// ── CCH hash algorithm (reverse-engineered from cli.js) ──
const CCH_SALT = '59cf53e54c78'
const CCH_POSITIONS = [4, 7, 20]

// Fallback for non-message requests where no user message exists
const FALLBACK_HASH = randomBytes(2).toString('hex').slice(0, 3)

function computeCCH(firstUserMessageText: string, version: string): string {
  const chars = CCH_POSITIONS.map(i => firstUserMessageText[i] || '0').join('')
  return createHash('sha256')
    .update(`${CCH_SALT}${chars}${version}`)
    .digest('hex')
    .slice(0, 3)
}

/**
 * Extract first user message text from API request messages array.
 * API format uses role: "user", content can be string or array of blocks.
 */
function extractFirstUserMessage(messages: any[]): string {
  if (!Array.isArray(messages)) return ''
  const firstUser = messages.find((m: any) => m.role === 'user')
  if (!firstUser) return ''
  if (typeof firstUser.content === 'string') return firstUser.content
  if (Array.isArray(firstUser.content)) {
    const textBlock = firstUser.content.find((b: any) => b.type === 'text')
    if (textBlock?.text) return textBlock.text
  }
  return ''
}

/**
 * Rewrite identity fields in the API request body.
 *
 * Handles two request types:
 * 1. /v1/messages - rewrite metadata.user_id JSON blob
 * 2. /api/event_logging/batch - rewrite event_data identity/env/process fields
 */
export function rewriteBody(body: Buffer, path: string, config: Config): Buffer {
  const text = body.toString('utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON - pass through unchanged
    return body
  }

  if (path.startsWith('/v1/messages')) {
    rewriteMessagesBody(parsed, config)
  } else if (path.includes('/event_logging/batch')) {
    rewriteEventBatch(parsed, config)
  } else if (path.includes('/policy_limits') || path.includes('/settings')) {
    rewriteGenericIdentity(parsed, config)
  }

  return Buffer.from(JSON.stringify(parsed), 'utf-8')
}

/**
 * Rewrite /v1/messages request body.
 *
 * Order matters:
 * 1. Rewrite user message content (paths, etc.) FIRST
 * 2. Extract first user message from REWRITTEN content
 * 3. Compute hash from rewritten message (so it matches what server sees)
 * 4. Rewrite system prompt billing header using computed hash
 */
function rewriteMessagesBody(body: any, config: Config) {
  // Rewrite metadata.user_id
  if (body?.metadata?.user_id) {
    try {
      const userId = JSON.parse(body.metadata.user_id)
      userId.device_id = config.identity.device_id
      body.metadata.user_id = JSON.stringify(userId)
      log('debug', `Rewrote metadata.user_id device_id`)
    } catch {
      log('warn', `Failed to parse metadata.user_id`)
    }
  }

  // Step 1: Rewrite <system-reminder> blocks in messages (injected by CC, not user content).
  // We do NOT rewrite general user message text — that would corrupt user intent.
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        msg.content = rewriteSystemReminders(msg.content, config)
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.text) {
            block.text = rewriteSystemReminders(block.text, config)
          }
        }
      }
    }
  }

  // Step 2: Extract first user message from content (after system-reminder rewrite)
  const firstUserText = extractFirstUserMessage(body.messages)

  // Step 3: Compute hash from rewritten message + canonical version
  const version = String(config.env.version)
  const hash = firstUserText ? computeCCH(firstUserText, version) : FALLBACK_HASH
  log('debug', `Computed CCH: ${hash} (from ${firstUserText.length} char message)`)

  // Step 4: Strip billing header block from system prompt (cache optimization).
  // If client set CLAUDE_CODE_ATTRIBUTION_HEADER=false, the block won't exist.
  // This is the gateway-side safety net for clients that didn't set it.
  if (Array.isArray(body.system)) {
    // Remove system blocks that are purely the billing header
    body.system = body.system.filter((item: any) => {
      const text = typeof item === 'string' ? item : item?.text
      if (typeof text === 'string' && /^\s*x-anthropic-billing-header:/.test(text)) {
        log('debug', 'Stripped billing header block from system prompt')
        return false
      }
      return true
    })

    // Rewrite remaining system blocks (env, paths, etc.)
    for (let i = 0; i < body.system.length; i++) {
      const item = body.system[i]
      if (typeof item === 'string') {
        body.system[i] = rewritePromptText(item, config, hash)
      } else if (item?.text) {
        item.text = rewritePromptText(item.text, config, hash)
      }
    }
  } else if (typeof body.system === 'string') {
    // Strip inline billing header if embedded in a single string
    body.system = body.system.replace(/x-anthropic-billing-header:[^\n]+\n?/g, '')
    body.system = rewritePromptText(body.system, config, hash)
  }
}

/**
 * Comprehensive text rewriter for system prompt and user messages.
 *
 * When hash is provided, rewrites the billing header hash.
 * When hash is null, only rewrites env/path fields (used for messages before hash computation).
 */
function rewritePromptText(text: string, config: Config, hash: string | null): string {
  const pe = config.prompt_env
  if (!pe) return text

  let result = text

  // 1. Billing header fingerprint (only when hash is available)
  if (hash !== null) {
    result = result.replace(
      /cc_version=[\d.]+\.[a-f0-9]{3}/g,
      `cc_version=${config.env.version}.${hash}`,
    )
  }

  // 2. <env> block format:
  //    Platform: linux → Platform: darwin
  //    Shell: bash → Shell: zsh
  //    OS Version: Linux 6.5.0-xxx → OS Version: Darwin 24.4.0
  result = result.replace(
    /Platform:\s*\S+/g,
    `Platform: ${pe.platform}`,
  )
  result = result.replace(
    /Shell:\s*\S+/g,
    `Shell: ${pe.shell}`,
  )
  result = result.replace(
    /OS Version:\s*[^\n<]+/g,
    `OS Version: ${pe.os_version}`,
  )

  // 3. Working directory line. A home-based cwd (/Users/x/… or /home/x/…) is
  //    LEFT for Step 4 to mask structurally — swap only the home prefix, keep
  //    the project subpath — which is reversible for any number of distinct
  //    cwds/projects in one request. Only a non-home cwd (no username to hide)
  //    is collapsed to the canonical working_dir.
  result = result.replace(
    /((?:Primary )?[Ww]orking directory:\s*)(\/\S+)/g,
    (m, label, p) => (/^\/(?:Users|home)\/[^/]+\//.test(p) ? m : `${label}${pe.working_dir}`),
  )

  // 4. Home directory paths: /Users/xxx/, /home/xxx/ → swap username only,
  //    preserving the rest of the path (also masks the home-based cwd above).
  result = result.replace(
    /\/(?:Users|home)\/[^/\s]+\//g,
    `${pe.working_dir.match(/^\/[^/]+\/[^/]+\//)?.[0] || '/Users/user/'}`,
  )

  return result
}

/**
 * Scan the ORIGINAL (pre-rewrite) request body for the real cwd / home paths
 * that rewritePromptText is about to mask, and return the inverse mappings
 * (canonical → real). The proxy applies these to the model's streamed response
 * so bash/file tool calls reference real paths even though the prompt was
 * masked. Returns [] when masking can't be reversed (no working_dir, no real
 * path found, or already identical) — the caller then streams through untouched.
 */
export function extractReversePathMap(body: Buffer, config: Config): PathPair[] {
  const pe = config.prompt_env
  if (!pe?.working_dir || pe.reverse_paths === false) return []

  const text = body.toString('utf-8')
  const canonicalHome = pe.working_dir.match(/^\/[^/]+\/[^/]+\//)?.[0] || '/Users/user/'
  const pairs: PathPair[] = []

  // Non-home cwds are the only ones Step 3 collapses into working_dir; map that
  // back to the first such cwd. Home-based cwds keep their structure (Step 4
  // swaps just the username) and are reversed by the home-prefix pair below —
  // which covers ANY number of distinct projects/cwds under that home.
  const cwds = [...text.matchAll(/(?:Primary )?[Ww]orking directory:\s*(\/[^\s"\\]+)/g)].map((m) => m[1])
  const nonHomeCwd = cwds.find((c) => !/^\/(?:Users|home)\/[^/]+\//.test(c))
  if (nonHomeCwd && nonHomeCwd !== pe.working_dir) pairs.push({ from: pe.working_dir, to: nonHomeCwd })

  // Real home prefix (what Step 4 collapses into canonicalHome).
  const home = text.match(/\/(?:Users|home)\/[^/\s"\\]+\//)?.[0]
  if (home && home !== canonicalHome) pairs.push({ from: canonicalHome, to: home })

  // Apply the most specific (longest) prefix first so working_dir wins over the
  // bare home prefix it contains (e.g. /Users/jack/projects before /Users/jack/).
  pairs.sort((a, b) => b.from.length - a.from.length)
  return pairs
}

/**
 * Streaming literal replacer that is safe across chunk boundaries. Holds back up
 * to (longest 'from' length − 1) chars between pushes so a search target split
 * between two network chunks still matches. StringDecoder guarantees multi-byte
 * UTF-8 characters are never cut mid-sequence. Call push() per chunk, flush() at
 * end.
 */
export function createPathReplacer(pairs: PathPair[]) {
  const decoder = new StringDecoder('utf8')
  const froms = pairs.map((p) => p.from)
  const maxFrom = Math.max(...froms.map((f) => f.length), 1)
  let pending = '' // unreplaced carry-over: a partial prefix of some 'from'

  const apply = (s: string): string => {
    for (const p of pairs) s = s.split(p.from).join(p.to)
    return s
  }

  // Length of the longest suffix of s that is a STRICT prefix of some 'from'.
  // Those trailing chars might still grow into a match — or into a longer match
  // that supersedes a shorter one sharing the prefix (e.g. /Users/jack/ vs
  // /Users/jack/projects) — so they're held back until the next chunk arrives.
  const heldBack = (s: string): number => {
    const max = Math.min(s.length, maxFrom - 1)
    for (let k = max; k >= 1; k--) {
      const suf = s.slice(s.length - k)
      for (const f of froms) {
        if (f.length > k && f.startsWith(suf)) return k
      }
    }
    return 0
  }

  return {
    push(buf: Buffer): string {
      pending += decoder.write(buf)
      const cut = pending.length - heldBack(pending)
      const head = pending.slice(0, cut)
      pending = pending.slice(cut)
      return apply(head)
    },
    flush(): string {
      const out = apply(pending + decoder.end())
      pending = ''
      return out
    },
  }
}

/**
 * Rewrite only <system-reminder> blocks within message text.
 * These are injected by Claude Code (env info, git status, etc.) — not user-authored.
 * User-written text outside these tags is left untouched to preserve intent.
 */
function rewriteSystemReminders(text: string, config: Config): string {
  return text.replace(
    /(<system-reminder>)([\s\S]*?)(<\/system-reminder>)/g,
    (_match, open, content, close) => {
      return open + rewritePromptText(content, config, null) + close
    },
  )
}

/**
 * Rewrite /api/event_logging/batch payload.
 * Each event has event_data with identity, env, and process fields.
 */
function rewriteEventBatch(body: any, config: Config) {
  if (!Array.isArray(body?.events)) return

  for (const event of body.events) {
    if (!event?.event_data) continue
    const data = event.event_data

    // Identity fields
    if (data.device_id) data.device_id = config.identity.device_id
    if (data.email) data.email = config.identity.email

    // Environment fingerprint - replace entirely with canonical
    if (data.env) {
      data.env = buildCanonicalEnv(config)
    }

    // Process metrics - generate realistic values
    if (data.process) {
      data.process = buildCanonicalProcess(data.process, config)
    }

    // Strip fields that leak gateway URL or proxy usage
    delete data.baseUrl
    delete data.base_url
    delete data.gateway

    // Additional metadata - rewrite base64-encoded blob if present
    if (data.additional_metadata) {
      data.additional_metadata = rewriteAdditionalMetadata(data.additional_metadata, config)
    }

    log('debug', `Rewrote event: ${data.event_name || 'unknown'}`)
  }
}

function rewriteGenericIdentity(body: any, config: Config) {
  if (typeof body !== 'object' || body === null) return
  if (body.device_id) body.device_id = config.identity.device_id
  if (body.email) body.email = config.identity.email
}

function buildCanonicalEnv(config: Config): Record<string, unknown> {
  return {
    platform: config.env.platform,
    platform_raw: config.env.platform_raw || config.env.platform,
    arch: config.env.arch,
    node_version: config.env.node_version,
    terminal: config.env.terminal,
    package_managers: config.env.package_managers,
    runtimes: config.env.runtimes,
    is_running_with_bun: config.env.is_running_with_bun ?? false,
    is_ci: false,
    is_claubbit: false,
    is_claude_code_remote: false,
    is_local_agent_mode: false,
    is_conductor: false,
    is_github_action: false,
    is_claude_code_action: false,
    is_claude_ai_auth: config.env.is_claude_ai_auth ?? true,
    version: config.env.version,
    version_base: config.env.version_base || config.env.version,
    build_time: config.env.build_time,
    deployment_environment: config.env.deployment_environment,
    vcs: config.env.vcs,
  }
}

function buildCanonicalProcess(original: any, config: Config): any {
  if (typeof original === 'string') {
    try {
      const decoded = JSON.parse(Buffer.from(original, 'base64').toString('utf-8'))
      const rewritten = rewriteProcessFields(decoded, config)
      return Buffer.from(JSON.stringify(rewritten)).toString('base64')
    } catch {
      return original
    }
  }
  if (typeof original === 'object') {
    return rewriteProcessFields(original, config)
  }
  return original
}

function rewriteProcessFields(proc: any, config: Config): any {
  const { constrained_memory, rss_range, heap_total_range, heap_used_range } = config.process
  return {
    ...proc,
    constrainedMemory: constrained_memory,
    rss: randomInRange(rss_range[0], rss_range[1]),
    heapTotal: randomInRange(heap_total_range[0], heap_total_range[1]),
    heapUsed: randomInRange(heap_used_range[0], heap_used_range[1]),
  }
}

function rewriteAdditionalMetadata(original: string, config: Config): string {
  try {
    const decoded = JSON.parse(Buffer.from(original, 'base64').toString('utf-8'))
    delete decoded.baseUrl
    delete decoded.base_url
    delete decoded.gateway
    return Buffer.from(JSON.stringify(decoded)).toString('base64')
  } catch {
    return original
  }
}

function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min))
}

/**
 * Rewrite HTTP headers to canonical identity.
 * Uses the hash computed during body rewriting (getCurrentHash).
 */
export function rewriteHeaders(
  headers: Record<string, string | string[] | undefined>,
  config: Config,
): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue
    const v = Array.isArray(value) ? value.join(', ') : value
    const lower = key.toLowerCase()

    // Skip hop-by-hop headers and auth (gateway injects the real OAuth token)
    if (['host', 'connection', 'proxy-authorization', 'proxy-connection', 'transfer-encoding', 'authorization', 'x-api-key'].includes(lower)) {
      continue
    }

    if (lower === 'user-agent') {
      out[key] = `claude-code/${config.env.version} (external, cli)`
    } else if (lower === 'x-anthropic-billing-header') {
      // Strip billing header entirely — consistent with CLAUDE_CODE_ATTRIBUTION_HEADER=false
      // This also maximizes cross-session prompt cache sharing
      continue
    } else {
      out[key] = v
    }
  }

  return out
}
