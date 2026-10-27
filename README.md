# CC Gateway

English | [Tiếng Việt](README.vi.md)

A gateway between Claude Code and the Anthropic API that lets a team share **several Claude accounts** from one place:

- Many Claude accounts on one server, each with its own identity (`device_id`, email, environment fingerprint) and, optionally, its own outbound proxy.
- Each client (person) gets its own token and is assigned one or more accounts in priority order, with a cost limit per client–account pair. When one account's limit is used up, the client moves on to the next.
- Web dashboard: add accounts and **re-login them right in the browser**, create clients, assign accounts, watch cost per client/account and each account's 5-hour / weekly quota.
- All state lives in SQLite under `data/`; restarts and redeploys never lose it.
- Users install one launcher and use Claude Code as usual.

Visual walkthrough (route map, live account-selection simulator, account lifecycle): download [`docs/how-it-works.html`](docs/how-it-works.html) and open it in a browser (Vietnamese). Detailed operations guide: [`README.vi.md`](README.vi.md). VPS deploy with GitHub Actions: [`deploy/vps/README.md`](deploy/vps/README.md).

## How it works

Clients keep running Claude Code as before. The gateway sits in the middle: it picks a Claude account that is still usable, rewrites the request to that account's identity, and forwards it with that account's OAuth token.

```mermaid
flowchart LR
  A[alice] & B[bob] & C[... more clients] -->|client token| N[nginx / TLS]
  N --> G{{cc-gateway}}
  G -->|pro-1 identity + token| U[api.anthropic.com]
  G -->|pro-2 identity + token| U
  G -->|pro-3 via its own proxy_url| P[HTTP proxy] --> U
```

### One request, step by step

| # | Step | Can stop with |
|---|------|---------------|
| 1 | **Identify the client** by its token (`clients` table). | `401` unknown token |
| 2 | **Load its account bindings** (`client_accounts`): each has a priority (lower is tried first) and its own cost limit. | `503` no account assigned |
| 3 | **Pick an account**: walk the bindings by priority and take the first one that is enabled, has a valid token, and where this client's spend in the period (lifetime / monthly / daily, UTC) is under the limit. A limit of `0` means unlimited. Only billable `/v1/messages` requests are limit-gated. | `429` every usable account is over its limit (the body lists used/limit per account); `503` every account is disabled or needs re-login |
| 4 | **Rewrite the identity** to the chosen account: `device_id`, email, env fingerprint, prompt env; mask the client's local paths. | |
| 5 | **Forward** with the account's OAuth access token, through the account's `proxy_url` if set (otherwise the global `HTTPS_PROXY`, otherwise direct). | |
| 6 | **Stream the response back**, un-mask paths, **record** cost per (client, account), and update that account's 5h/weekly quota from Anthropic's headers. | |

The gateway does **not** fail over when Anthropic returns 429/401 mid-request: that request returns the real error, and a broken account is skipped from the next request on.

### Account lifecycle

Each account keeps its own tokens and refresh timer, so one broken account never takes another down.

```mermaid
stateDiagram-v2
  [*] --> uninitialized: Add account (dashboard)
  uninitialized --> ok: Re-login (open link, paste code)
  ok --> refreshing: 5 min before expiry
  refreshing --> ok: refreshed
  refreshing --> refreshing: transient error, retry 30s..10min
  refreshing --> expired: refresh_token rejected
  expired --> ok: Re-login
```

Per account you can edit the label, email, env / prompt env overrides and an optional `proxy_url` (`http://user:pass@host:port`; the password is never shown back). With no `proxy_url`, every account goes out through the server's IP.

### Where state lives

Everything is in `data/` (Docker volume or bind mount):

| Path | Contents |
|------|----------|
| `ccg.db` → `accounts` | OAuth tokens, identity and proxy per account |
| `ccg.db` → `clients`, `client_accounts` | client tokens; bindings with priority + limit |
| `ccg.db` → `request_metrics`, `users`, `meta` | per-request cost, admin users, setup state |
| `config.yaml` | static settings + identity template for new accounts |
| `backups/` | SQLite backups (the VPS deploy keeps 14) |

The `oauth:` / `auth.tokens` keys of `config.yaml` are read **once**, to migrate an old single-account install into the database. After that, editing them has no effect; everything is managed in the dashboard.

### Who does what

- **Admin** (`/admin`): creates the first admin with the setup code printed in the logs; adds accounts and logs them in from the dashboard; creates clients and assigns accounts in priority order with per-pair limits; watches cost per client/account and each account's 5h/weekly quota.
- **Client user**: installs the launcher once and uses Claude Code normally; sees the remaining limit per account at `/portal`.

## What gets rewritten

Every value below comes from the **account chosen** for that request (accounts without their own value use the template in `config.yaml`).

| Layer | Field | Action |
|-------|-------|--------|
| Identity | `device_id` in metadata and events | replaced by the account's `device_id` |
| | `email` | replaced by the account's email |
| Environment | `env` object (40+ fields) | whole object replaced |
| Process | `constrainedMemory`, `rss`, `heapTotal`, `heapUsed` | normalized to fixed values / ranges |
| Headers | `User-Agent` | canonical Claude Code version (auto-updated daily) |
| | client `x-api-key` | replaced by the account's OAuth access token |
| | `x-anthropic-billing-header` | stripped |
| Prompt | `Platform`, `Shell`, `OS Version`, `Working directory` | replaced by `prompt_env` |
| | paths like `/Users/xxx/`, `/home/xxx/`, `C:\Users\xxx\` | masked to a canonical path, reversed in the response |
| Telemetry | `baseUrl`, `gateway` | stripped so the gateway is not revealed |

## Installation

### Docker on a fresh server

No Claude login on the server and no mounted credentials needed.

```bash
git clone https://github.com/vuluu2k/cc-gateway.git && cd cc-gateway
docker compose -f deploy/vps/docker-compose.yml up -d --build
docker compose -f deploy/vps/docker-compose.yml logs gateway | grep -i 'setup code'
```

1. The container boots with zero accounts and prints a **setup code** (single use, expires after 24 hours; restart the container to print a new one).
2. Open `https://<domain>/admin` and enter a username, password and the setup code to create the first admin.
3. **Accounts → Add account**, then **Re-login**: open the Claude link, approve, and paste the code into the box below it.
4. **Clients → + Add client** to create a client and download its launcher; on that client's row, **Accounts for this client** assigns accounts (priority, limit, period).

The gateway serves HTTP on port `8443`, bound to `127.0.0.1` by default; set `BIND_IP=<private IP>` in `deploy/vps/.env` if the reverse proxy runs on another machine. Put a TLS reverse proxy in front (nginx, Caddy, Traefik…) and forward `Host` and `X-Forwarded-Proto` (see [`deploy/vps/nginx-ccg.conf`](deploy/vps/nginx-ccg.conf)). Data lives in `data/` next to the repo.

### Automatic deploy to a VPS

Push to `main` → a GitHub Actions runner installed on the VPS backs up the DB, rebuilds and restarts the container, then checks `/_health`. Runner setup, repo variables and the backup cron: [`deploy/vps/README.md`](deploy/vps/README.md). If the repo is public, you **must** enable *Require approval for all external contributors* for fork pull request workflows.

### Local development

Requires Node.js 22+.

```bash
npm install
npm run dev        # tsx watch with auto-reload; default config at ./data/config.yaml
npm test           # all tests (tsx + assert)
npm run build      # compile to dist/
```

On a Mac already logged in to Claude Code, `bash scripts/quick-setup.sh` reads the credentials from the Keychain, writes `config.yaml` and a launcher; on first start that account is imported into the database as account `default`.

## Client usage

The admin sends the `cc-<name>` launcher downloaded from the dashboard. The user runs:

```bash
chmod +x cc-alice
./cc-alice install        # installs the 'ccg' command
ccg                       # run Claude Code through the gateway
```

```
ccg                       Run Claude Code through the gateway (all claude arguments work)
ccg install / uninstall   Install / remove the 'ccg' command
ccg hijack / release      Route 'claude' through the gateway too / restore it
ccg native [args]         Run the native claude once, bypassing the gateway
ccg status                Check the connection to the gateway
```

Remaining limit per account: `https://<domain>/portal`.

## Configuration

`data/config.yaml` is generated on first start and only holds static settings:

| Key | Meaning |
|-----|---------|
| `server.port`, `server.tls` | listen port; TLS if there is no reverse proxy in front |
| `upstream.url` | defaults to `https://api.anthropic.com` |
| `identity`, `env`, `prompt_env`, `process` | identity and fingerprint **template** for new accounts; each account can override them in the dashboard |
| `logging`, `db.path` | log level; SQLite path |

Accounts, clients, bindings and limits are **not** in `config.yaml`; they live in the database and are managed in the dashboard.

| Environment variable | Effect |
|----------------------|--------|
| `CCG_CONFIG_PATH` | path to `config.yaml` (default `/app/data/config.yaml`) |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | shared proxy for accounts without their own `proxy_url` |
| `CCG_REFRESH_TOKEN` (or `CCG_CREDENTIALS_PATH`) | optional: seed the first account on a fresh server and skip the browser login |
| `CCG_DISABLE_VERSION_AUTOUPDATE` | disable the daily Claude Code version update |

## Caveats

- **No failover on upstream errors.** An account rate-limited by Anthropic (429) or with an expired session (401) fails that request for real; only *your own* cost limits move a client to the next account.
- **Shared IP.** Accounts without a `proxy_url` all go out through the server's IP. To give an account its own IP, set an HTTP(S) proxy for it (SOCKS is not supported).
- **Official MCP servers** (`mcp-proxy.anthropic.com`) ignore `ANTHROPIC_BASE_URL` and bypass the gateway. You can block them with Clash; see [`clash-rules.yaml`](clash-rules.yaml).
- **New Claude Code versions** may add telemetry fields or endpoints; re-check after upgrading.
- **Route every machine through the gateway**, the admin's included, so no second fingerprint shows up for the same account.

## License

MIT, see [`LICENSE`](LICENSE).
