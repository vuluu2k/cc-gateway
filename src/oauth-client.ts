import { request as httpsRequest } from 'https'
import { createHash, randomBytes } from 'crypto'
import { getProxyAgent } from './proxy-agent.js'

const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
// Manual ("paste the code") login flow, mirroring what the Claude Code CLI does
// when it cannot open a localhost listener. Verified against Claude Code 2.1.243.
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const MANUAL_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const DEFAULT_SCOPES = [
  'user:inference',
  'user:profile',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
]

export const LOGIN_TTL_MS = 15 * 60 * 1000

export type OAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  // When the REFRESH token itself expires, if the server told us. Returned to
  // the caller rather than stored here: this module holds no state, and each
  // account tracks its own value. Undefined when the server omitted it.
  refreshTokenExpiresAt?: number
}

/** PKCE material for one in-flight login. The caller owns it — this module
 *  keeps no state, so N accounts can log in concurrently. */
export type PendingLogin = {
  verifier: string
  state: string
  expiresAt: number
}

/** Thrown when the refresh_token is definitively unusable — retrying won't help. */
export class OAuthPermanentError extends Error {}

// ── HTTP plumbing ──

type TokenResponse = {
  status: number
  data: Record<string, unknown> | null
  raw: string
}

/**
 * POST a JSON body to the OAuth token endpoint.
 *
 * Every failure path resolves or rejects the promise — nothing is allowed to
 * throw synchronously inside a socket event handler, because that would surface
 * as an uncaughtException and kill the process. A non-JSON body (an upstream
 * HTML error page, a captive-portal interstitial) is reported, not parsed.
 */
function postToken(body: Record<string, unknown>): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const url = new URL(TOKEN_URL)
    const agent = getProxyAgent()
    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }

    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
        },
        ...(agent && { agent }),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (settled) return
          settled = true
          const raw = Buffer.concat(chunks).toString('utf-8')
          let data: Record<string, unknown> | null = null
          try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
          } catch {
            data = null
          }
          resolve({ status: res.statusCode || 0, data, raw })
        })
      },
    )
    req.on('error', fail)
    req.setTimeout(30_000, () => {
      req.destroy(new Error('OAuth token request timed out after 30s'))
    })
    req.write(payload)
    req.end()
  })
}

/** Truncated response body, safe to put in a log line or the dashboard. */
function describeFailure(res: TokenResponse): string {
  if (res.data) {
    const err = typeof res.data.error === 'string' ? res.data.error : null
    const desc = typeof res.data.error_description === 'string' ? res.data.error_description : null
    if (err || desc) return `${res.status}: ${[err, desc].filter(Boolean).join(' — ')}`
    return `${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`
  }
  const snippet = res.raw.replace(/\s+/g, ' ').trim().slice(0, 200)
  return `${res.status}: non-JSON response (${snippet || 'empty body'})`
}

/**
 * A 400/401 from the token endpoint means the grant itself was rejected — a
 * consumed, rotated, or revoked refresh_token. Retrying replays the same dead
 * credential, so treat it as permanent. 429/5xx stay retryable.
 */
function isPermanent(res: TokenResponse): boolean {
  if (res.status !== 400 && res.status !== 401 && res.status !== 403) return false
  const err = res.data && typeof res.data.error === 'string' ? res.data.error : ''
  if (!err) return true
  return err !== 'server_error' && err !== 'temporarily_unavailable'
}

function tokensFromResponse(data: Record<string, unknown>, fallbackRefresh: string): OAuthTokens {
  const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
  if (!accessToken) throw new Error('OAuth response contained no access_token')
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const refreshTokenExpiresAt =
    typeof data.refresh_token_expires_in === 'number'
      ? Date.now() + data.refresh_token_expires_in * 1000
      : undefined
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
      ? data.refresh_token
      : fallbackRefresh,
    expiresAt: Date.now() + expiresIn * 1000,
    refreshTokenExpiresAt,
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function refreshOAuthToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  })
  if (res.status !== 200 || !res.data) {
    const message = describeFailure(res)
    if (isPermanent(res)) throw new OAuthPermanentError(message)
    throw new Error(message)
  }
  return tokensFromResponse(res.data, refreshToken)
}

/**
 * Start a login. The PKCE verifier is returned to the caller instead of being
 * stashed in a module variable, so several accounts can have a login pending at
 * the same time.
 */
export function beginOAuthLogin(): {
  url: string
  pending: PendingLogin
  expiresInMs: number
} {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const loginState = b64url(randomBytes(24))

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.append('code', 'true')
  url.searchParams.append('client_id', CLIENT_ID)
  url.searchParams.append('response_type', 'code')
  url.searchParams.append('redirect_uri', MANUAL_REDIRECT_URI)
  url.searchParams.append('scope', DEFAULT_SCOPES.join(' '))
  url.searchParams.append('code_challenge', challenge)
  url.searchParams.append('code_challenge_method', 'S256')
  url.searchParams.append('state', loginState)

  return {
    url: url.toString(),
    pending: { verifier, state: loginState, expiresAt: Date.now() + LOGIN_TTL_MS },
    expiresInMs: LOGIN_TTL_MS,
  }
}

/**
 * The callback page shows the code as `<code>#<state>`; some browsers hand back
 * the whole redirect URL instead. Accept both, plus a bare code.
 */
export function parsePastedCode(input: string): { code: string; state: string | null } {
  let value = input.trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const code = url.searchParams.get('code') || ''
      return { code: code.trim(), state: url.searchParams.get('state') }
    } catch {
      // fall through to the plain-string handling below
    }
  }
  value = value.replace(/^code=/i, '')
  const hash = value.indexOf('#')
  if (hash === -1) return { code: value, state: null }
  return { code: value.slice(0, hash).trim(), state: value.slice(hash + 1).trim() || null }
}

export async function completeOAuthLogin(
  pasted: string,
  pending: PendingLogin,
): Promise<OAuthTokens> {
  if (pending.expiresAt <= Date.now()) {
    throw new Error('Login request expired — start a new one')
  }

  const { code, state: pastedState } = parsePastedCode(pasted)
  if (!code) throw new Error('No authorization code found in the pasted value')
  if (pastedState && pastedState !== pending.state) {
    throw new Error('State mismatch — the pasted code belongs to a different login attempt')
  }

  const res = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: MANUAL_REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pending.verifier,
    state: pending.state,
  })
  if (res.status !== 200 || !res.data) {
    throw new Error(`Token exchange failed (${describeFailure(res)})`)
  }

  const tokens = tokensFromResponse(res.data, '')
  if (!tokens.refreshToken) {
    throw new Error('Token exchange returned no refresh_token')
  }
  return tokens
}
