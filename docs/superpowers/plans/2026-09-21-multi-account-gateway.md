# Multi-Account Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một container cc-gateway phục vụ N tài khoản Claude, mỗi client gắn được nhiều account theo thứ tự ưu tiên với hạn mức riêng từng cặp, và cài đặt được hoàn toàn trong Docker.

**Architecture:** Toàn bộ trạng thái động (account, client, binding, token OAuth) chuyển từ `config.yaml` vào SQLite. `src/oauth.ts` — vốn là singleton biến-module — tách làm `oauth-client.ts` (thuần hàm, không state) và `accounts.ts` (một `Map` runtime, mỗi account một timer refresh độc lập). Chọn account là một hàm thuần `selectAccountFor()`; `proxy.ts` chỉ gọi và xử lý kết quả. Danh tính per-account đạt được bằng cách dựng một `Config` hiệu dụng cho mỗi request thay vì sửa `rewriter.ts`.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 22, better-sqlite3, `yaml`, `tsx` để chạy test. Không test framework — file test tự chạy, dùng `assert` và tự đếm pass/fail.

**Spec:** `docs/superpowers/specs/2026-09-21-multi-account-gateway-design.md`

## Global Constraints

- **Không tự động failover khi upstream trả 429/401.** Chỉ "hết hạn mức thì tràn xuống account kế tiếp". Account chết bị loại ở lần chọn *kế tiếp*; request đang chạy trả lỗi thật về client.
- **Không có hạn mức cấp account.** Hạn mức chỉ tồn tại ở cặp `(client, account)`.
- `accounts.state` nhận đúng bốn giá trị: `uninitialized | ok | refreshing | expired`.
- `client_accounts.limit_period` nhận đúng ba giá trị: `lifetime | monthly | daily`.
- `client_accounts.priority`: **số nhỏ hơn = ưu tiên trước**.
- `limit_usd = 0` nghĩa là **không giới hạn**, không phải "chặn hết".
- `accounts.device_id` luôn là 64 ký tự hex.
- **Một account hỏng không được ảnh hưởng account khác.** Đây là bất biến chính của `src/accounts.ts`.
- Mọi import nội bộ dùng đuôi `.js` (ESM NodeNext), kể cả khi file nguồn là `.ts`.
- **i18n có ba ngôn ngữ, không phải hai.** `src/i18n.ts:8` khai báo `Locale = 'en' | 'vi' | 'zh'`; mỗi khoá trong từ điển `M` phải đủ `{ en, vi, zh }`, thiếu một cái là lỗi kiểu. Khoá đặt theo nhóm với tiền tố có dấu chấm.
- **i18n chạy phía trình duyệt.** HTML đánh dấu bằng `data-i18n` / `data-i18n-html` / `data-i18n-ph`; JS sinh chuỗi thì gọi `window.t(key, vars)` (trong `dashboard.ts` đã có sẵn alias `const t = (k, v) => (window.t ? window.t(k, v) : k)`). **Không** render sẵn chuỗi đã dịch từ server.
- Comment trong code viết bằng **tiếng Anh**, theo đúng phần còn lại của repo.
- Commit message chỉ dùng ký tự ASCII.
- Sau mỗi task: `npm test` xanh và `npx tsc --noEmit` sạch. **Một ngoại lệ duy nhất: Task 9.** Nó đổi kiểu trả về của `authenticate()` nên `src/proxy.ts` và `src/portal.ts` chắc chắn vỡ kiểu cho tới khi Task 10 sửa. Task 9 được commit với `tsc` còn lỗi **chỉ ở hai file đó**; Task 10 bắt buộc trả `tsc` về sạch. Mọi task khác không có ngoại lệ.

## Lưu ý về test và DB

`initDb()` chạy `resolve(path)`, nên **`':memory:'` không dùng được** — nó sẽ biến thành đường dẫn `<cwd>/:memory:`. Mọi test chạm DB phải dùng file tạm:

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
const dbPath = join(dir, 'test.db')
// ... initDb(dbPath) ...
// at end of file: rmSync(dir, { recursive: true, force: true })
```

## File Structure

**Tạo mới:**

| File | Trách nhiệm |
|---|---|
| `src/accounts-store.ts` | CRUD thuần SQLite cho `accounts`, `clients`, `client_accounts`. Không biết gì về OAuth hay HTTP. |
| `src/oauth-client.ts` | Giao tiếp HTTP với endpoint OAuth. Thuần hàm, không giữ state. |
| `src/accounts.ts` | Runtime N account: `Map` token + state + timer refresh, và `selectAccountFor()`. |
| `src/effective-config.ts` | Dựng `Config` hiệu dụng từ `Config` gốc + một account. |
| `src/migrate-accounts.ts` | Migration một chiều `config.yaml` → DB. |
| `src/dashboard-accounts.ts` | Render tab Accounts (tách khỏi `dashboard.ts` vốn đã 2138 dòng). |
| `tests/accounts-store.test.ts` | |
| `tests/oauth-client.test.ts` | |
| `tests/accounts.test.ts` | |
| `tests/routing.test.ts` | |
| `tests/effective-config.test.ts` | |
| `tests/migration.test.ts` | |

**Sửa:** `src/db.ts` (schema), `src/metrics.ts` (cột + truy vấn), `src/auth.ts` (nguồn token), `src/proxy.ts` (routing + API), `src/config.ts` (nới lỏng validate), `src/bootstrap-config.ts` (bỏ exit), `src/index.ts` (thứ tự khởi động), `src/dashboard.ts` (tab + binding UI), `src/portal.ts` (quota theo account), `src/i18n.ts`, `src/rewriter.ts` (chỉ bổ sung test), `package.json`, `docker-compose.yml`.

**Xoá:** `src/oauth.ts` (ở Task 5, sau khi `accounts.ts` thay thế xong).

---

### Task 1: Schema cho account, client và binding

**Files:**
- Modify: `src/db.ts:27-95` (hàm `migrate`)
- Test: `tests/accounts-store.test.ts`
- Modify: `package.json:20` (script `test`)

**Interfaces:**
- Consumes: `initDb(path)`, `getDb()` từ `src/db.ts` (đã có)
- Produces: ba bảng `accounts`, `clients`, `client_accounts`; cột `request_metrics.account_id`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/accounts-store.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'test.db'))

console.log('\nschema - accounts / clients / client_accounts\n')

test('tạo đủ ba bảng mới', () => {
  const names = (getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>).map((r) => r.name)
  assert.ok(names.includes('accounts'))
  assert.ok(names.includes('clients'))
  assert.ok(names.includes('client_accounts'))
})

test('request_metrics có cột account_id mặc định rỗng', () => {
  const cols = (getDb()
    .prepare('PRAGMA table_info(request_metrics)')
    .all() as Array<{ name: string }>).map((c) => c.name)
  assert.ok(cols.includes('account_id'))
})

test('client_accounts cascade khi xoá client', () => {
  const db = getDb()
  // Bind device_id as a parameter: SQLite parses SQL, it does not run
  // JavaScript, so `.repeat()` inside a SQL string is a syntax error.
  db.prepare(
    'INSERT INTO accounts (id, device_id, created_at) VALUES (?, ?, ?)',
  ).run('a1', 'ab'.repeat(32), 0)
  db.prepare(
    'INSERT INTO clients (name, token, created_at) VALUES (?, ?, ?)',
  ).run('c1', 'tok1', 0)
  db.prepare(
    'INSERT INTO client_accounts (client_name, account_id) VALUES (?, ?)',
  ).run('c1', 'a1')
  db.prepare(`DELETE FROM clients WHERE name = 'c1'`).run()
  const left = db
    .prepare(`SELECT COUNT(*) AS n FROM client_accounts`)
    .get() as { n: number }
  assert.equal(left.n, 0)
})

test('chạy migrate hai lần không lỗi', () => {
  // initDb runs migrate; calling it again on the same file must be a silent no-op
  initDb(join(dir, 'test.db'))
  const names = (getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>).map((r) => r.name)
  assert.ok(names.includes('accounts'))
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/accounts-store.test.ts`
Expected: FAIL — `no such table: accounts`

- [ ] **Step 3: Thêm schema vào `migrate()`**

Trong `src/db.ts`, nối vào cuối chuỗi `db.exec(\`...\`)` ở `migrate()` (ngay trước dòng `-- 2026-05 schema bump` comment):

```sql
    -- Upstream Claude accounts. Each carries its own spoofed identity so the
    -- API sees N independent machines, not one machine juggling N logins.
    CREATE TABLE IF NOT EXISTS accounts (
      id              TEXT PRIMARY KEY,
      label           TEXT    NOT NULL DEFAULT '',
      refresh_token   TEXT    NOT NULL DEFAULT '',
      access_token    TEXT    NOT NULL DEFAULT '',
      expires_at      INTEGER NOT NULL DEFAULT 0,
      state           TEXT    NOT NULL DEFAULT 'uninitialized',
      last_error      TEXT    NOT NULL DEFAULT '',
      last_refresh_at INTEGER NOT NULL DEFAULT 0,
      device_id       TEXT    NOT NULL,
      email           TEXT    NOT NULL DEFAULT '',
      env_json        TEXT    NOT NULL DEFAULT '',
      prompt_env_json TEXT    NOT NULL DEFAULT '',
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL
    );

    -- Proxy clients. Moved out of config.yaml's auth.tokens so the dashboard
    -- can manage them without rewriting YAML on every change.
    CREATE TABLE IF NOT EXISTS clients (
      name       TEXT PRIMARY KEY,
      token      TEXT NOT NULL UNIQUE,
      home_dir   TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    -- Which accounts a client may spend against, in what order, up to how much.
    -- Lower priority wins. limit_usd = 0 means unlimited.
    CREATE TABLE IF NOT EXISTS client_accounts (
      client_name  TEXT    NOT NULL REFERENCES clients(name) ON DELETE CASCADE,
      account_id   TEXT    NOT NULL REFERENCES accounts(id)  ON DELETE CASCADE,
      priority     INTEGER NOT NULL DEFAULT 0,
      limit_usd    REAL    NOT NULL DEFAULT 0,
      limit_period TEXT    NOT NULL DEFAULT 'lifetime',
      PRIMARY KEY (client_name, account_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ca_client_priority
      ON client_accounts(client_name, priority);
```

Rồi thêm vào khối bump cột, ngay sau dòng `if (!has('error_detail')) ...`:

```ts
  // ── 2026-09 schema bump: multi-account attribution ──
  if (!has('account_id')) addCol("account_id TEXT NOT NULL DEFAULT ''")
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_rm_client_acct_ts ON request_metrics(client, account_id, ts)',
  )
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/accounts-store.test.ts`
Expected: PASS — 4 passed, 0 failed

- [ ] **Step 5: Nối vào `npm test`**

Trong `package.json`, đổi script `test` thành:

```json
"test": "tsx tests/rewriter.test.ts && tsx tests/preview.test.ts && tsx tests/ratelimit.test.ts && tsx tests/pricing.test.ts && tsx tests/accounts-store.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/db.ts tests/accounts-store.test.ts package.json
git commit -m "feat(db): accounts, clients and client_accounts schema"
```

---

### Task 2: `accounts-store.ts` — CRUD thuần DB

**Files:**
- Create: `src/accounts-store.ts`
- Test: `tests/accounts-store.test.ts` (nối thêm vào file đã có)

**Interfaces:**
- Consumes: `getDb()` từ `src/db.ts`
- Produces:
  ```ts
  export type AccountState = 'uninitialized' | 'ok' | 'refreshing' | 'expired'
  export type LimitPeriod = 'lifetime' | 'monthly' | 'daily'

  export type AccountRow = {
    id: string; label: string
    refreshToken: string; accessToken: string; expiresAt: number
    state: AccountState; lastError: string; lastRefreshAt: number
    deviceId: string; email: string
    env: Record<string, unknown> | null
    promptEnv: Record<string, unknown> | null
    enabled: boolean; createdAt: number
  }
  export type ClientRow = { name: string; token: string; homeDir: string; createdAt: number }
  export type BindingRow = {
    clientName: string; accountId: string
    priority: number; limitUsd: number; limitPeriod: LimitPeriod
  }

  export function listAccountRows(): AccountRow[]
  export function getAccountRow(id: string): AccountRow | null
  export function insertAccountRow(input: {
    id: string; label?: string; deviceId?: string; email?: string
    env?: Record<string, unknown> | null; promptEnv?: Record<string, unknown> | null
    refreshToken?: string; accessToken?: string; expiresAt?: number
  }): AccountRow
  export function updateAccountRow(id: string, patch: Partial<Omit<AccountRow, 'id' | 'createdAt'>>): AccountRow
  export function deleteAccountRow(id: string): void
  export function generateDeviceId(): string

  export function listClientRows(): ClientRow[]
  export function getClientRow(name: string): ClientRow | null
  export function insertClientRow(input: { name: string; token: string; homeDir?: string }): ClientRow
  export function deleteClientRow(name: string): void

  export function listBindings(clientName: string): BindingRow[]
  export function listBindingsForAccount(accountId: string): BindingRow[]
  export function replaceBindings(clientName: string, rows: Array<Omit<BindingRow, 'clientName'>>): void
  ```

- [ ] **Step 1: Viết test thất bại**

Chèn vào `tests/accounts-store.test.ts`, **trước** dòng `rmSync(...)` cuối file (và thêm import ở đầu file):

```ts
import {
  insertAccountRow, getAccountRow, updateAccountRow, deleteAccountRow,
  listAccountRows, generateDeviceId,
  insertClientRow, listBindings, replaceBindings, listBindingsForAccount,
} from '../src/accounts-store.js'
```

```ts
console.log('\naccounts-store\n')

test('generateDeviceId sinh 64 hex', () => {
  const id = generateDeviceId()
  assert.equal(id.length, 64)
  assert.ok(/^[0-9a-f]{64}$/.test(id))
  assert.notEqual(id, generateDeviceId())
})

test('insertAccountRow điền mặc định và sinh device_id', () => {
  const acc = insertAccountRow({ id: 'pro-1', label: 'Pro 1' })
  assert.equal(acc.id, 'pro-1')
  assert.equal(acc.state, 'uninitialized')
  assert.equal(acc.enabled, true)
  assert.equal(acc.deviceId.length, 64)
  assert.equal(acc.env, null)
})

test('insertAccountRow trùng id thì ném lỗi', () => {
  assert.throws(() => insertAccountRow({ id: 'pro-1' }))
})

test('updateAccountRow round-trip env qua JSON', () => {
  const acc = updateAccountRow('pro-1', { env: { platform: 'linux', arch: 'x64' } })
  assert.deepEqual(acc.env, { platform: 'linux', arch: 'x64' })
  assert.deepEqual(getAccountRow('pro-1')!.env, { platform: 'linux', arch: 'x64' })
})

test('updateAccountRow chỉ đổi trường được truyền', () => {
  const acc = updateAccountRow('pro-1', { state: 'ok' })
  assert.equal(acc.state, 'ok')
  assert.equal(acc.label, 'Pro 1')
  assert.deepEqual(acc.env, { platform: 'linux', arch: 'x64' })
})

test('replaceBindings thay cả mảng, sắp theo priority', () => {
  insertAccountRow({ id: 'pro-2' })
  insertClientRow({ name: 'alice', token: 'tok-alice' })
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 5, limitUsd: 5, limitPeriod: 'monthly' },
    { accountId: 'pro-1', priority: 1, limitUsd: 10, limitPeriod: 'monthly' },
  ])
  const rows = listBindings('alice')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].accountId, 'pro-1')
  assert.equal(rows[0].limitUsd, 10)
  assert.equal(rows[1].accountId, 'pro-2')
})

test('replaceBindings gọi lần hai xoá binding cũ', () => {
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 0, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const rows = listBindings('alice')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].accountId, 'pro-2')
})

test('listBindingsForAccount thấy client đang dùng account', () => {
  const rows = listBindingsForAccount('pro-2')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].clientName, 'alice')
})

test('deleteAccountRow xoá luôn binding', () => {
  deleteAccountRow('pro-2')
  assert.equal(getAccountRow('pro-2'), null)
  assert.equal(listBindings('alice').length, 0)
  assert.equal(listAccountRows().length, 1)
})
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/accounts-store.test.ts`
Expected: FAIL — `Cannot find module '../src/accounts-store.js'`

- [ ] **Step 3: Viết `src/accounts-store.ts`**

```ts
import { randomBytes } from 'crypto'
import { getDb } from './db.js'

export type AccountState = 'uninitialized' | 'ok' | 'refreshing' | 'expired'
export type LimitPeriod = 'lifetime' | 'monthly' | 'daily'

export type AccountRow = {
  id: string
  label: string
  refreshToken: string
  accessToken: string
  expiresAt: number
  state: AccountState
  lastError: string
  lastRefreshAt: number
  deviceId: string
  email: string
  env: Record<string, unknown> | null
  promptEnv: Record<string, unknown> | null
  enabled: boolean
  createdAt: number
}

export type ClientRow = {
  name: string
  token: string
  homeDir: string
  createdAt: number
}

export type BindingRow = {
  clientName: string
  accountId: string
  priority: number
  limitUsd: number
  limitPeriod: LimitPeriod
}

type RawAccount = {
  id: string; label: string; refresh_token: string; access_token: string
  expires_at: number; state: string; last_error: string; last_refresh_at: number
  device_id: string; email: string; env_json: string; prompt_env_json: string
  enabled: number; created_at: number
}

/** Parse a stored JSON column. An empty or malformed value means "inherit". */
function parseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function toAccount(r: RawAccount): AccountRow {
  return {
    id: r.id,
    label: r.label,
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    expiresAt: r.expires_at,
    state: r.state as AccountState,
    lastError: r.last_error,
    lastRefreshAt: r.last_refresh_at,
    deviceId: r.device_id,
    email: r.email,
    env: parseJson(r.env_json),
    promptEnv: parseJson(r.prompt_env_json),
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }
}

export function generateDeviceId(): string {
  return randomBytes(32).toString('hex')
}

export function listAccountRows(): AccountRow[] {
  return (getDb()
    .prepare('SELECT * FROM accounts ORDER BY created_at ASC, id ASC')
    .all() as RawAccount[]).map(toAccount)
}

export function getAccountRow(id: string): AccountRow | null {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
    | RawAccount
    | undefined
  return row ? toAccount(row) : null
}

export function insertAccountRow(input: {
  id: string
  label?: string
  deviceId?: string
  email?: string
  env?: Record<string, unknown> | null
  promptEnv?: Record<string, unknown> | null
  refreshToken?: string
  accessToken?: string
  expiresAt?: number
}): AccountRow {
  getDb()
    .prepare(
      `INSERT INTO accounts (
        id, label, refresh_token, access_token, expires_at,
        device_id, email, env_json, prompt_env_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.label || '',
      input.refreshToken || '',
      input.accessToken || '',
      input.expiresAt || 0,
      input.deviceId || generateDeviceId(),
      input.email || '',
      input.env ? JSON.stringify(input.env) : '',
      input.promptEnv ? JSON.stringify(input.promptEnv) : '',
      Date.now(),
    )
  return getAccountRow(input.id)!
}

const ACCOUNT_COLUMNS: Record<string, string> = {
  label: 'label',
  refreshToken: 'refresh_token',
  accessToken: 'access_token',
  expiresAt: 'expires_at',
  state: 'state',
  lastError: 'last_error',
  lastRefreshAt: 'last_refresh_at',
  deviceId: 'device_id',
  email: 'email',
  enabled: 'enabled',
}

export function updateAccountRow(
  id: string,
  patch: Partial<Omit<AccountRow, 'id' | 'createdAt'>>,
): AccountRow {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(ACCOUNT_COLUMNS)) {
    if (!(key in patch)) continue
    const value = (patch as Record<string, unknown>)[key]
    sets.push(`${column} = ?`)
    values.push(key === 'enabled' ? (value ? 1 : 0) : value)
  }
  if ('env' in patch) {
    sets.push('env_json = ?')
    values.push(patch.env ? JSON.stringify(patch.env) : '')
  }
  if ('promptEnv' in patch) {
    sets.push('prompt_env_json = ?')
    values.push(patch.promptEnv ? JSON.stringify(patch.promptEnv) : '')
  }

  if (sets.length > 0) {
    values.push(id)
    getDb().prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  const row = getAccountRow(id)
  if (!row) throw new Error(`No such account: ${id}`)
  return row
}

export function deleteAccountRow(id: string): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

export function listClientRows(): ClientRow[] {
  return (getDb()
    .prepare('SELECT * FROM clients ORDER BY name ASC')
    .all() as Array<{ name: string; token: string; home_dir: string; created_at: number }>).map(
    (r) => ({ name: r.name, token: r.token, homeDir: r.home_dir, createdAt: r.created_at }),
  )
}

export function getClientRow(name: string): ClientRow | null {
  const r = getDb().prepare('SELECT * FROM clients WHERE name = ?').get(name) as
    | { name: string; token: string; home_dir: string; created_at: number }
    | undefined
  return r ? { name: r.name, token: r.token, homeDir: r.home_dir, createdAt: r.created_at } : null
}

export function insertClientRow(input: {
  name: string
  token: string
  homeDir?: string
}): ClientRow {
  getDb()
    .prepare('INSERT INTO clients (name, token, home_dir, created_at) VALUES (?, ?, ?, ?)')
    .run(input.name, input.token, input.homeDir || '', Date.now())
  return getClientRow(input.name)!
}

export function deleteClientRow(name: string): void {
  getDb().prepare('DELETE FROM clients WHERE name = ?').run(name)
}

function toBinding(r: {
  client_name: string; account_id: string
  priority: number; limit_usd: number; limit_period: string
}): BindingRow {
  return {
    clientName: r.client_name,
    accountId: r.account_id,
    priority: r.priority,
    limitUsd: r.limit_usd,
    limitPeriod: r.limit_period as LimitPeriod,
  }
}

export function listBindings(clientName: string): BindingRow[] {
  return (getDb()
    .prepare(
      'SELECT * FROM client_accounts WHERE client_name = ? ORDER BY priority ASC, account_id ASC',
    )
    .all(clientName) as Parameters<typeof toBinding>[0][]).map(toBinding)
}

export function listBindingsForAccount(accountId: string): BindingRow[] {
  return (getDb()
    .prepare('SELECT * FROM client_accounts WHERE account_id = ? ORDER BY client_name ASC')
    .all(accountId) as Parameters<typeof toBinding>[0][]).map(toBinding)
}

/**
 * Swap a client's whole binding set in one transaction. Replacing the array
 * wholesale keeps the UI simple and rules out half-applied states that a
 * per-row CRUD surface would allow.
 */
export function replaceBindings(
  clientName: string,
  rows: Array<Omit<BindingRow, 'clientName'>>,
): void {
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare('DELETE FROM client_accounts WHERE client_name = ?').run(clientName)
    const insert = db.prepare(
      `INSERT INTO client_accounts (client_name, account_id, priority, limit_usd, limit_period)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const row of rows) {
      insert.run(clientName, row.accountId, row.priority, row.limitUsd, row.limitPeriod)
    }
  })
  run()
}
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/accounts-store.test.ts`
Expected: PASS — 13 passed, 0 failed

- [ ] **Step 5: Kiểm tra kiểu**

Run: `npx tsc --noEmit`
Expected: không có lỗi

- [ ] **Step 6: Commit**

```bash
git add src/accounts-store.ts tests/accounts-store.test.ts
git commit -m "feat(accounts): SQLite store for accounts, clients and bindings"
```

---

### Task 3: Migration `config.yaml` → DB

**Files:**
- Create: `src/migrate-accounts.ts`
- Test: `tests/migration.test.ts`
- Modify: `src/config.ts:22-46` (type `Config`), `src/config.ts:73-87` (`loadConfig`)
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: `insertAccountRow`, `insertClientRow`, `replaceBindings` (Task 2); `getDb()` từ `src/db.ts`
- Produces:
  ```ts
  export function migrateFromConfig(config: Config): boolean  // true nếu đã migrate lần này
  ```

- [ ] **Step 1: KHÔNG đụng `src/config.ts` ở task này**

> **Sửa kế hoạch (ruling của controller, 2026-09-21).** Bản đầu của task này yêu cầu nới
> lỏng `auth`/`oauth` thành tuỳ chọn ngay tại đây. Làm vậy sẽ phá **7 chỗ gọi** đang đọc
> chúng — `src/auth.ts:7`, `src/index.ts:68,81,93,97`, `src/proxy.ts:82,116` — khiến
> `npx tsc --noEmit` đỏ, vi phạm ràng buộc toàn cục. Việc nới lỏng được dời đi:
>
> - `oauth` thành tuỳ chọn ở **Task 5**, nơi `initOAuth` (người đọc cuối cùng) bị xoá.
> - `auth` thành tuỳ chọn ở **Task 9**, nơi client chuyển hẳn sang DB.
>
> Task này **không sửa `src/config.ts`**. `migrateFromConfig` đọc bằng optional chaining
> (`config.oauth?.refresh_token`, `config.auth?.tokens || []`) — hợp lệ với TypeScript kể
> cả khi trường chưa phải optional, nên code của bạn chạy đúng ở cả trước và sau khi hai
> task kia nới lỏng kiểu.

- [ ] **Step 2: Viết test thất bại**

Tạo `tests/migration.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb, getDb } from '../src/db.js'
import { migrateFromConfig } from '../src/migrate-accounts.js'
import { listAccountRows, listClientRows, listBindings } from '../src/accounts-store.js'
import type { Config } from '../src/config.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'test.db'))

const legacyConfig = {
  oauth: { access_token: 'acc-tok', refresh_token: 'ref-tok', expires_at: 1234 },
  auth: {
    tokens: [
      { name: 'alice', token: 'tok-a', cost_limit_usd: 10, cost_limit_period: 'monthly' },
      { name: 'bob', token: 'tok-b', home_dir: '/home/bob' },
    ],
  },
  identity: { device_id: 'cd'.repeat(32), email: 'legacy@example.com' },
} as unknown as Config

console.log('\nmigration - config.yaml → DB\n')

// A legacy metrics row, written before account_id existed.
getDb()
  .prepare(
    `INSERT INTO request_metrics (ts, client, method, path, status, duration_ms)
     VALUES (0, 'alice', 'POST', '/v1/messages', 200, 5)`,
  )
  .run()

test('migrate tạo một account default mang identity cũ', () => {
  assert.equal(migrateFromConfig(legacyConfig), true)
  const accounts = listAccountRows()
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].id, 'default')
  assert.equal(accounts[0].refreshToken, 'ref-tok')
  assert.equal(accounts[0].accessToken, 'acc-tok')
  assert.equal(accounts[0].expiresAt, 1234)
  assert.equal(accounts[0].deviceId, 'cd'.repeat(32))
  assert.equal(accounts[0].email, 'legacy@example.com')
  assert.equal(accounts[0].env, null)
})

test('mỗi auth.tokens thành một client', () => {
  const clients = listClientRows()
  assert.equal(clients.length, 2)
  assert.deepEqual(clients.map((c) => c.name), ['alice', 'bob'])
  assert.equal(clients.find((c) => c.name === 'bob')!.homeDir, '/home/bob')
})

test('cost limit cũ chuyển sang binding tới default', () => {
  const alice = listBindings('alice')
  assert.equal(alice.length, 1)
  assert.equal(alice[0].accountId, 'default')
  assert.equal(alice[0].priority, 0)
  assert.equal(alice[0].limitUsd, 10)
  assert.equal(alice[0].limitPeriod, 'monthly')

  const bob = listBindings('bob')
  assert.equal(bob[0].limitUsd, 0)
  assert.equal(bob[0].limitPeriod, 'lifetime')
})

test('metrics cũ được gán về account default', () => {
  const row = getDb()
    .prepare(`SELECT account_id FROM request_metrics WHERE client = 'alice'`)
    .get() as { account_id: string }
  assert.equal(row.account_id, 'default')
})

test('chạy lần hai là no-op, không nhân đôi', () => {
  assert.equal(migrateFromConfig(legacyConfig), false)
  assert.equal(listAccountRows().length, 1)
  assert.equal(listClientRows().length, 2)
  assert.equal(listBindings('alice').length, 1)
})

test('config không có oauth thì không migrate gì', () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'ccg-test-'))
  initDb(join(dir2, 'fresh.db'))
  assert.equal(migrateFromConfig({} as Config), false)
  assert.equal(listAccountRows().length, 0)
  rmSync(dir2, { recursive: true, force: true })
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 3: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/migration.test.ts`
Expected: FAIL — `Cannot find module '../src/migrate-accounts.js'`

- [ ] **Step 4: Viết `src/migrate-accounts.ts`**

```ts
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

    for (const entry of tokens) {
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
```

- [ ] **Step 5: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/migration.test.ts`
Expected: PASS — 6 passed, 0 failed

- [ ] **Step 6: Nối vào `npm test` và chạy toàn bộ**

Thêm ` && tsx tests/migration.test.ts` vào script `test`.

Run: `npm test && npx tsc --noEmit`
Expected: mọi suite PASS, không lỗi kiểu

- [ ] **Step 7: Commit**

```bash
git add src/migrate-accounts.ts src/config.ts tests/migration.test.ts package.json
git commit -m "feat(accounts): one-way migration from single-account config.yaml"
```

---

### Task 4: Tách `oauth-client.ts` — thuần hàm, không state

**Files:**
- Create: `src/oauth-client.ts`
- Test: `tests/oauth-client.test.ts`
- Modify: `package.json` (script `test`)

`src/oauth.ts` **chưa bị xoá** ở task này — nó vẫn chạy nguyên vẹn để gateway không gãy giữa chừng. Task 5 mới thay nó.

**Interfaces:**
- Consumes: `getProxyAgent()` từ `src/proxy-agent.ts`, `log` từ `src/logger.ts`
- Produces:
  ```ts
  export type OAuthTokens = {
    accessToken: string; refreshToken: string; expiresAt: number
    refreshTokenExpiresAt?: number   // trả ra cho caller, KHÔNG giữ trong module
  }
  export type PendingLogin = { verifier: string; state: string; expiresAt: number }

  export class OAuthPermanentError extends Error {}
  export const LOGIN_TTL_MS: number

  export function refreshOAuthToken(refreshToken: string): Promise<OAuthTokens>
  export function beginOAuthLogin(): { url: string; pending: PendingLogin; expiresInMs: number }
  export function completeOAuthLogin(pasted: string, pending: PendingLogin): Promise<OAuthTokens>
  export function parsePastedCode(input: string): { code: string; state: string | null }
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/oauth-client.test.ts`. Chỉ test phần thuần tuý — không gọi mạng:

```ts
import { strict as assert } from 'assert'
import { parsePastedCode, beginOAuthLogin, LOGIN_TTL_MS } from '../src/oauth-client.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

console.log('\noauth-client - parsePastedCode\n')

test('mã trần', () => {
  assert.deepEqual(parsePastedCode('abc123'), { code: 'abc123', state: null })
})

test('dạng code#state', () => {
  assert.deepEqual(parsePastedCode('abc123#st-9'), { code: 'abc123', state: 'st-9' })
})

test('tiền tố code=', () => {
  assert.deepEqual(parsePastedCode('code=abc123#st-9'), { code: 'abc123', state: 'st-9' })
})

test('cả URL redirect', () => {
  const url = 'https://platform.claude.com/oauth/code/callback?code=abc123&state=st-9'
  assert.deepEqual(parsePastedCode(url), { code: 'abc123', state: 'st-9' })
})

test('cắt khoảng trắng thừa', () => {
  assert.deepEqual(parsePastedCode('  abc123#st-9  '), { code: 'abc123', state: 'st-9' })
})

console.log('\noauth-client - beginOAuthLogin\n')

test('trả về pending riêng cho từng lần gọi', () => {
  const a = beginOAuthLogin()
  const b = beginOAuthLogin()
  assert.notEqual(a.pending.verifier, b.pending.verifier)
  assert.notEqual(a.pending.state, b.pending.state)
  assert.equal(a.expiresInMs, LOGIN_TTL_MS)
})

test('URL mang đủ tham số PKCE', () => {
  const { url, pending } = beginOAuthLogin()
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get('response_type'), 'code')
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(parsed.searchParams.get('state'), pending.state)
  assert.ok(parsed.searchParams.get('code_challenge'))
  // the challenge must be the hash, never the raw verifier
  assert.notEqual(parsed.searchParams.get('code_challenge'), pending.verifier)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/oauth-client.test.ts`
Expected: FAIL — `Cannot find module '../src/oauth-client.js'`

- [ ] **Step 3: Viết `src/oauth-client.ts`**

Chuyển các hằng số và hàm HTTP từ `src/oauth.ts` sang, bỏ mọi biến module giữ state. Copy nguyên `postToken` (dòng 246-298), `describeFailure` (299-314), `isPermanent` (315-321), `tokensFromResponse` (322-337) và lớp `OAuthPermanentError`, rồi thêm:

```ts
import { request as httpsRequest } from 'https'
import { createHash, randomBytes } from 'crypto'
import { getProxyAgent } from './proxy-agent.js'

const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
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
}

/** PKCE material for one in-flight login. The caller owns it — this module
 *  keeps no state, so N accounts can log in concurrently. */
export type PendingLogin = {
  verifier: string
  state: string
  expiresAt: number
}

// ... postToken / describeFailure / isPermanent / tokensFromResponse /
//     OAuthPermanentError copied verbatim from src/oauth.ts ...

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
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/oauth-client.test.ts`
Expected: PASS — 7 passed, 0 failed

- [ ] **Step 5: Nối vào `npm test`, kiểm tra kiểu**

Thêm ` && tsx tests/oauth-client.test.ts` vào script `test`.

Run: `npm test && npx tsc --noEmit`
Expected: mọi suite PASS, không lỗi kiểu

- [ ] **Step 6: Commit**

```bash
git add src/oauth-client.ts tests/oauth-client.test.ts package.json
git commit -m "refactor(oauth): extract stateless oauth-client from oauth.ts"
```

---

### Task 5: `accounts.ts` — runtime N account

**Files:**
- Create: `src/accounts.ts`
- Test: `tests/accounts.test.ts`
- Delete: `src/oauth.ts`
- Modify: `src/index.ts:5,52-72`, `src/proxy.ts` (import `getAccessToken`, `getOAuthStatus`, `beginOAuthLogin`, `completeOAuthLogin`, `cancelOAuthLogin`), `src/bootstrap-config.ts` (xoá `updateConfigOAuth`), `package.json`

**Interfaces:**
- Consumes: `accounts-store.ts` (Task 2), `oauth-client.ts` (Task 4)
- Produces:
  ```ts
  export type AccountView = {
    id: string; label: string; state: AccountState
    expiresAt: number; lastError: string; lastRefreshAt: number
    deviceId: string; email: string
    env: Record<string, unknown> | null
    promptEnv: Record<string, unknown> | null
    enabled: boolean; hasRefreshToken: boolean; loginPending: boolean
    refreshTokenExpiresAt: number | null
  }

  export async function initAccounts(): Promise<void>
  export function listAccounts(): AccountView[]
  export function getAccountView(id: string): AccountView | null
  export function createAccount(input: {
    id: string; label?: string; email?: string; deviceId?: string
    env?: Record<string, unknown> | null
    promptEnv?: Record<string, unknown> | null
  }): AccountView
  export function updateAccount(id: string, patch: {
    label?: string; email?: string; enabled?: boolean
    env?: Record<string, unknown> | null
    promptEnv?: Record<string, unknown> | null
  }): AccountView
  export function deleteAccount(id: string): void
  export function getAccessTokenFor(id: string): string | null
  export function isUsable(id: string): boolean
  export function beginLogin(id: string): { url: string; expires_in_ms: number }
  export function completeLogin(id: string, pasted: string): Promise<{ expires_at: number }>
  export function cancelLogin(id: string): void
  export function _resetAccountsRuntime(): void   // chỉ dùng trong test
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/accounts.test.ts`. Không gọi mạng — chỉ kiểm tra CRUD, bất biến cách ly, và tính khả dụng:

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { updateAccountRow } from '../src/accounts-store.js'
import {
  initAccounts, listAccounts, getAccountView, createAccount, updateAccount,
  deleteAccount, getAccessTokenFor, isUsable, beginLogin, cancelLogin,
  _resetAccountsRuntime,
} from '../src/accounts.js'
import { insertClientRow, replaceBindings } from '../src/accounts-store.js'

let passed = 0
let failed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'test.db'))

console.log('\naccounts - runtime\n')

await test('createAccount sinh device_id và trạng thái ban đầu', () => {
  const acc = createAccount({ id: 'pro-1', label: 'Pro 1' })
  assert.equal(acc.id, 'pro-1')
  assert.equal(acc.state, 'uninitialized')
  assert.equal(acc.hasRefreshToken, false)
  assert.equal(acc.enabled, true)
  assert.equal(acc.deviceId.length, 64)
  assert.equal(acc.loginPending, false)
})

await test('device_id của hai account là khác nhau', () => {
  const a = getAccountView('pro-1')!
  const b = createAccount({ id: 'pro-2' })
  assert.notEqual(a.deviceId, b.deviceId)
})

await test('AccountView không lộ refresh_token', () => {
  const acc = getAccountView('pro-1')! as Record<string, unknown>
  assert.equal(acc.refreshToken, undefined)
  assert.equal(acc.accessToken, undefined)
})

await test('createAccount trùng id thì ném lỗi', () => {
  assert.throws(() => createAccount({ id: 'pro-1' }))
})

await test('account chưa login thì không dùng được', () => {
  assert.equal(getAccessTokenFor('pro-1'), null)
  assert.equal(isUsable('pro-1'), false)
})

await test('account có token còn hạn thì dùng được', async () => {
  updateAccountRow('pro-1', {
    accessToken: 'live-token',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    state: 'ok',
  })
  _resetAccountsRuntime()
  await initAccounts()
  assert.equal(getAccessTokenFor('pro-1'), 'live-token')
  assert.equal(isUsable('pro-1'), true)
})

await test('token hết hạn thì không dùng được', () => {
  updateAccountRow('pro-1', { expiresAt: Date.now() - 1000 })
  _resetAccountsRuntime()
  assert.equal(getAccessTokenFor('pro-1'), null)
})

await test('một account expired không ảnh hưởng account còn lại', async () => {
  updateAccountRow('pro-1', {
    accessToken: 'live-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    state: 'ok',
  })
  updateAccountRow('pro-2', { state: 'expired', lastError: 'invalid_grant' })
  _resetAccountsRuntime()
  await initAccounts()
  assert.equal(isUsable('pro-1'), true)
  assert.equal(isUsable('pro-2'), false)
  assert.equal(getAccountView('pro-2')!.state, 'expired')
})

await test('account bị tắt thì không dùng được dù token còn hạn', () => {
  updateAccount('pro-1', { enabled: false })
  assert.equal(isUsable('pro-1'), false)
  updateAccount('pro-1', { enabled: true })
  assert.equal(isUsable('pro-1'), true)
})

await test('beginLogin đánh dấu loginPending, cancelLogin gỡ ra', () => {
  const started = beginLogin('pro-2')
  assert.ok(started.url.startsWith('https://claude.com/cai/oauth/authorize'))
  assert.equal(getAccountView('pro-2')!.loginPending, true)
  // pro-2's pending login must not leak into pro-1
  assert.equal(getAccountView('pro-1')!.loginPending, false)
  cancelLogin('pro-2')
  assert.equal(getAccountView('pro-2')!.loginPending, false)
})

await test('deleteAccount bị chặn khi còn binding', () => {
  insertClientRow({ name: 'alice', token: 'tok-a' })
  replaceBindings('alice', [
    { accountId: 'pro-2', priority: 0, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  assert.throws(() => deleteAccount('pro-2'), /alice/)
})

await test('deleteAccount chạy khi không còn binding', () => {
  replaceBindings('alice', [])
  deleteAccount('pro-2')
  assert.equal(getAccountView('pro-2'), null)
  assert.equal(listAccounts().length, 1)
})

rmSync(dir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/accounts.test.ts`
Expected: FAIL — `Cannot find module '../src/accounts.js'`

- [ ] **Step 3: Viết `src/accounts.ts`**

```ts
import { log } from './logger.js'
import {
  listAccountRows, getAccountRow, insertAccountRow, updateAccountRow,
  deleteAccountRow, listBindingsForAccount,
} from './accounts-store.js'
import type { AccountRow, AccountState } from './accounts-store.js'
import {
  refreshOAuthToken, beginOAuthLogin, completeOAuthLogin,
  OAuthPermanentError, LOGIN_TTL_MS,
} from './oauth-client.js'
import type { OAuthTokens, PendingLogin } from './oauth-client.js'

const FIVE_MINUTES = 5 * 60 * 1000

/** Everything the dashboard may see. Deliberately excludes the tokens. */
export type AccountView = {
  id: string
  label: string
  state: AccountState
  expiresAt: number
  lastError: string
  lastRefreshAt: number
  deviceId: string
  email: string
  env: Record<string, unknown> | null
  promptEnv: Record<string, unknown> | null
  enabled: boolean
  hasRefreshToken: boolean
  loginPending: boolean
  // In-memory only, per process - see Runtime above.
  refreshTokenExpiresAt: number | null
}

type Runtime = {
  refreshTimer: NodeJS.Timeout | null
  failureCount: number
  // When the REFRESH token itself expires. In-memory only and reset on restart,
  // exactly as the old oauth.ts module variable behaved. Null when unknown.
  refreshTokenExpiresAt: number | null
}

// One runtime slot per account. Timers live here, not in the DB, so a crashed
// refresh on one account can never stall another.
const runtimes = new Map<string, Runtime>()
const pendingLogins = new Map<string, PendingLogin>()
let missingTokenLoggedAt = new Map<string, number>()

function runtimeOf(id: string): Runtime {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { refreshTimer: null, failureCount: 0, refreshTokenExpiresAt: null }
    runtimes.set(id, rt)
  }
  return rt
}

function clearTimerFor(id: string) {
  const rt = runtimes.get(id)
  if (rt?.refreshTimer) {
    clearTimeout(rt.refreshTimer)
    rt.refreshTimer = null
  }
}

function toView(row: AccountRow): AccountView {
  const pending = pendingLogins.get(row.id)
  return {
    id: row.id,
    label: row.label,
    state: row.state,
    expiresAt: row.expiresAt,
    lastError: row.lastError,
    lastRefreshAt: row.lastRefreshAt,
    deviceId: row.deviceId,
    email: row.email,
    env: row.env,
    promptEnv: row.promptEnv,
    enabled: row.enabled,
    hasRefreshToken: row.refreshToken !== '',
    loginPending: pending !== undefined && pending.expiresAt > Date.now(),
    refreshTokenExpiresAt: runtimes.get(row.id)?.refreshTokenExpiresAt ?? null,
  }
}

/** Reset every in-memory timer and pending login. Test helper. */
export function _resetAccountsRuntime(): void {
  for (const id of runtimes.keys()) clearTimerFor(id)
  runtimes.clear()
  pendingLogins.clear()
  missingTokenLoggedAt = new Map()
}

/**
 * Load every enabled account and arm its refresh timer.
 *
 * Never throws: a dead refresh_token parks that ONE account in `expired` and
 * leaves the others running. The gateway must come up regardless so the admin
 * can reach the dashboard and log back in.
 */
export async function initAccounts(): Promise<void> {
  const rows = listAccountRows()
  if (rows.length === 0) {
    log('warn', 'No upstream accounts configured. /v1/* will answer 503.')
    log('warn', '  Add one from the admin dashboard → Accounts → "Add account".')
    return
  }

  await Promise.all(rows.filter((r) => r.enabled).map((row) => initOne(row)))

  const usable = rows.filter((r) => isUsable(r.id)).length
  log('info', `Accounts ready: ${usable}/${rows.length} usable`)
}

async function initOne(row: AccountRow): Promise<void> {
  const now = Date.now()

  if (row.accessToken && row.expiresAt > now + FIVE_MINUTES) {
    updateAccountRow(row.id, { state: 'ok', lastError: '' })
    scheduleRefresh(row.id, row.expiresAt)
    return
  }

  if (!row.refreshToken) {
    updateAccountRow(row.id, { state: 'uninitialized' })
    return
  }

  updateAccountRow(row.id, { state: 'refreshing' })
  await runRefresh(row.id)
}

function scheduleRefresh(id: string, expiresAt: number) {
  clearTimerFor(id)
  const refreshIn = Math.max(expiresAt - Date.now() - FIVE_MINUTES, 10_000)
  runtimeOf(id).refreshTimer = setTimeout(() => {
    void runRefresh(id)
  }, refreshIn)
}

async function runRefresh(id: string): Promise<void> {
  clearTimerFor(id)
  const row = getAccountRow(id)
  if (!row || !row.enabled) return
  if (!row.refreshToken) {
    updateAccountRow(id, { state: 'expired', lastError: 'no refresh_token available' })
    return
  }

  try {
    log('info', `Refreshing OAuth token for account "${id}"...`)
    const tokens = await refreshOAuthToken(row.refreshToken)
    persist(id, tokens)
    runtimeOf(id).failureCount = 0
    log('info', `Account "${id}" refreshed, expires at ${new Date(tokens.expiresAt).toISOString()}`)
    scheduleRefresh(id, tokens.expiresAt)
  } catch (err) {
    handleRefreshFailure(id, err)
  }
}

function persist(id: string, tokens: OAuthTokens) {
  if (tokens.refreshTokenExpiresAt !== undefined) {
    runtimeOf(id).refreshTokenExpiresAt = tokens.refreshTokenExpiresAt
  }
  updateAccountRow(id, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    state: 'ok',
    lastError: '',
    lastRefreshAt: Date.now(),
  })
}

/**
 * A permanent failure (invalid_grant) means this account's refresh_token is
 * gone for good — park it in `expired` and stop retrying. Anything else backs
 * off and tries again. Either way, only this account is affected.
 */
function handleRefreshFailure(id: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const rt = runtimeOf(id)
  rt.failureCount++

  if (err instanceof OAuthPermanentError) {
    updateAccountRow(id, { state: 'expired', lastError: message })
    clearTimerFor(id)
    log('error', `Account "${id}" refresh_token is no longer valid: ${message}`)
    log('error', `  Re-login from the admin dashboard → Accounts → "${id}".`)
    return
  }

  updateAccountRow(id, { state: 'refreshing', lastError: message })
  // 30s, 60s, 2m, 4m, … capped at 10 minutes.
  const delay = Math.min(30_000 * 2 ** (rt.failureCount - 1), 10 * 60_000)
  log('error', `Account "${id}" refresh failed (attempt ${rt.failureCount}): ${message}. Retrying in ${Math.round(delay / 1000)}s`)
  clearTimerFor(id)
  rt.refreshTimer = setTimeout(() => {
    void runRefresh(id)
  }, delay)
}

export function listAccounts(): AccountView[] {
  return listAccountRows().map(toView)
}

export function getAccountView(id: string): AccountView | null {
  const row = getAccountRow(id)
  return row ? toView(row) : null
}

export function createAccount(input: {
  id: string
  label?: string
  email?: string
  env?: Record<string, unknown> | null
  promptEnv?: Record<string, unknown> | null
  deviceId?: string
}): AccountView {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.id)) {
    throw new Error('Account id must be 1-64 chars: letters, digits or dashes')
  }
  if (getAccountRow(input.id)) {
    throw new Error(`Account "${input.id}" already exists`)
  }
  return toView(insertAccountRow(input))
}

export function updateAccount(
  id: string,
  patch: {
    label?: string
    email?: string
    enabled?: boolean
    env?: Record<string, unknown> | null
    promptEnv?: Record<string, unknown> | null
  },
): AccountView {
  const row = updateAccountRow(id, patch)
  if (patch.enabled === false) clearTimerFor(id)
  return toView(row)
}

/** Refuse while any client still points at it — silently breaking their
 *  routing is worse than making the admin unbind first. */
export function deleteAccount(id: string): void {
  const bindings = listBindingsForAccount(id)
  if (bindings.length > 0) {
    const names = bindings.map((b) => b.clientName).join(', ')
    throw new Error(`Account "${id}" is still used by: ${names}`)
  }
  clearTimerFor(id)
  runtimes.delete(id)
  pendingLogins.delete(id)
  deleteAccountRow(id)
}

export function getAccessTokenFor(id: string): string | null {
  const row = getAccountRow(id)
  if (!row || !row.enabled || !row.accessToken) return null
  if (Date.now() >= row.expiresAt) {
    logMissingToken(id, row.state)
    return null
  }
  return row.accessToken
}

export function isUsable(id: string): boolean {
  return getAccessTokenFor(id) !== null
}

/** Throttled per account so a burst of proxied requests can't flood the log. */
function logMissingToken(id: string, state: AccountState) {
  const now = Date.now()
  const last = missingTokenLoggedAt.get(id) || 0
  if (now - last < 30_000) return
  missingTokenLoggedAt.set(id, now)
  if (state === 'expired') {
    log('warn', `Account "${id}": refresh_token expired — re-login from the admin dashboard`)
  } else {
    log('warn', `Account "${id}": no access token available, waiting for refresh...`)
  }
}

export function beginLogin(id: string): { url: string; expires_in_ms: number } {
  if (!getAccountRow(id)) throw new Error(`No such account: ${id}`)
  const { url, pending, expiresInMs } = beginOAuthLogin()
  pendingLogins.set(id, pending)
  return { url, expires_in_ms: expiresInMs }
}

export function cancelLogin(id: string): void {
  pendingLogins.delete(id)
}

export async function completeLogin(
  id: string,
  pasted: string,
): Promise<{ expires_at: number }> {
  const pending = pendingLogins.get(id)
  if (!pending) throw new Error('No login in progress — start a new one')
  if (pending.expiresAt <= Date.now()) {
    pendingLogins.delete(id)
    throw new Error('Login request expired — start a new one')
  }

  const tokens = await completeOAuthLogin(pasted, pending)
  pendingLogins.delete(id)
  runtimeOf(id).failureCount = 0
  persist(id, tokens)
  scheduleRefresh(id, tokens.expiresAt)
  log('info', `Account "${id}" logged in, token expires at ${new Date(tokens.expiresAt).toISOString()}`)
  return { expires_at: tokens.expiresAt }
}

export { LOGIN_TTL_MS }
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/accounts.test.ts`
Expected: PASS — 12 passed, 0 failed

- [ ] **Step 5: Xoá `src/oauth.ts` và nối lại các chỗ gọi**

1. `rm src/oauth.ts`
2. `src/index.ts`: bỏ import `initOAuth, setOnTokensUpdated`, bỏ khối `setOnTokensUpdated(...)` (dòng 52-54), thay `await initOAuth(config.oauth)` bằng `await initAccounts()` và bỏ biến `oauthReady` (log cảnh báo đã nằm trong `initAccounts`).
3. `src/bootstrap-config.ts`: xoá hàm `updateConfigOAuth` — không còn ai gọi.
3b. `src/config.ts`: giờ mới đổi `oauth` thành tuỳ chọn, vì `initOAuth` — người đọc cuối
   cùng — vừa bị xoá:

   ```ts
     oauth?: {
       access_token?: string
       refresh_token: string
       expires_at?: number
     }
   ```

   Đồng thời xoá khối `throw` cho `oauth.refresh_token` trong `loadConfig`. **Chưa** đụng
   `auth` — Task 9 mới làm, vì `auth.ts` và `index.ts` còn đang đọc.
4. `src/proxy.ts`: các chỗ import từ `./oauth.js` tạm trỏ sang `./accounts.js`. `getOAuthStatus()` chưa có bản thay thế nên **tạm thời** đổi `/api/oauth` và `/_metrics` sang `{ accounts: listAccounts() }`; Task 11 sẽ hoàn thiện. `getAccessToken()` ở đường forward tạm dùng account đầu tiên khả dụng:

```ts
// TEMPORARY - Task 7 replaces this with selectAccountFor(). It only keeps
// the gateway runnable between the two tasks.
const firstUsable = listAccounts().find((a) => isUsable(a.id))
const accessToken = firstUsable ? getAccessTokenFor(firstUsable.id) : null
```

- [ ] **Step 6: Kiểm tra toàn bộ**

Thêm ` && tsx tests/accounts.test.ts` vào script `test`.

Run: `npm test && npx tsc --noEmit`
Expected: mọi suite PASS, không lỗi kiểu, không còn tham chiếu tới `./oauth.js`

Kiểm tra lần cuối: `grep -rn "from './oauth.js'" src/` phải không ra kết quả.

- [ ] **Step 7: Commit**

```bash
git add -A src tests package.json
git commit -m "feat(accounts): per-account OAuth runtime, retire oauth.ts singleton"
```

---

### Task 6: Chi phí theo cặp (client, account)

**Files:**
- Modify: `src/metrics.ts:12-31` (`RequestRecord`), `:53-77` (`recordRequest`), `:85-95` (thêm hàm mới)
- Test: `tests/routing.test.ts` (tạo mới, phần đầu)
- Modify: `package.json`

**Interfaces:**
- Consumes: `getDb()`, `periodStart()` (đã có trong `src/metrics.ts`)
- Produces:
  ```ts
  // RequestRecord gains: accountId?: string
  export function getClientAccountCostSince(client: string, accountId: string, sinceTs: number): number
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/routing.test.ts` với phần đầu:

```ts
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { strict as assert } from 'assert'
import { initDb } from '../src/db.js'
import { recordRequest, getClientAccountCostSince, getClientCostSince } from '../src/metrics.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'ccg-test-'))
initDb(join(dir, 'test.db'))

console.log('\nmetrics - chi phí theo cặp (client, account)\n')

function spend(client: string, accountId: string, costUsd: number) {
  recordRequest({
    ts: Date.now(),
    client,
    accountId,
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 10,
    costUsd,
  })
}

test('cộng dồn riêng từng account', () => {
  spend('alice', 'pro-1', 3)
  spend('alice', 'pro-1', 2)
  spend('alice', 'pro-2', 7)
  assert.equal(getClientAccountCostSince('alice', 'pro-1', 0), 5)
  assert.equal(getClientAccountCostSince('alice', 'pro-2', 0), 7)
})

test('không lẫn chi phí của client khác', () => {
  spend('bob', 'pro-1', 100)
  assert.equal(getClientAccountCostSince('alice', 'pro-1', 0), 5)
  assert.equal(getClientAccountCostSince('bob', 'pro-1', 0), 100)
})

test('getClientCostSince vẫn là tổng mọi account', () => {
  assert.equal(getClientCostSince('alice', 0), 12)
})

test('cặp chưa tiêu gì trả về 0', () => {
  assert.equal(getClientAccountCostSince('alice', 'max-1', 0), 0)
  assert.equal(getClientAccountCostSince('nobody', 'pro-1', 0), 0)
})

test('sinceTs lọc theo mốc thời gian', () => {
  const future = Date.now() + 60_000
  assert.equal(getClientAccountCostSince('alice', 'pro-1', future), 0)
})
```

(Phần routing sẽ nối vào file này ở Task 7; chưa thêm dòng đếm kết quả cuối file — thêm tạm:)

```ts
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
rmSync(dir, { recursive: true, force: true })
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/routing.test.ts`
Expected: FAIL — `getClientAccountCostSince is not a function`

- [ ] **Step 3: Sửa `src/metrics.ts`**

Thêm vào `RequestRecord`, ngay sau `client: string`:

```ts
  // Which upstream account paid for this request. Empty only for requests
  // rejected before an account was picked.
  accountId?: string
```

Trong `recordRequest`, thêm `account_id` vào danh sách cột, thêm một `?` vào `VALUES`, và truyền `rec.accountId || ''` ngay sau `rec.client`:

```ts
        `INSERT INTO request_metrics (
          ts, client, account_id, method, path, status, duration_ms,
          model, input_tokens, output_tokens,
          cache_read_tokens, cache_creation_tokens, cost_usd,
          user_message, error_source, error_detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.ts, rec.client, rec.accountId || '', rec.method, rec.path, rec.status, rec.durationMs,
        // ... the remaining arguments stay as they are
```

Thêm hàm mới ngay sau `getClientCostSince`:

```ts
/**
 * Sum of cost_usd for one (client, account) pair since the given timestamp.
 * This is what the per-binding quota is measured against — a client's spend on
 * account A must not count toward its limit on account B.
 */
export function getClientAccountCostSince(
  client: string,
  accountId: string,
  sinceTs: number,
): number {
  try {
    const row = getDb()
      .prepare(
        'SELECT SUM(cost_usd) as cost FROM request_metrics WHERE client = ? AND account_id = ? AND ts >= ?',
      )
      .get(client, accountId, sinceTs) as { cost: number | null }
    return row?.cost || 0
  } catch {
    return 0
  }
}
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/routing.test.ts`
Expected: PASS — 5 passed, 0 failed

- [ ] **Step 5: Nối vào `npm test`, kiểm tra kiểu**

Thêm ` && tsx tests/routing.test.ts` vào script `test`.

Run: `npm test && npx tsc --noEmit`
Expected: mọi suite PASS, không lỗi kiểu

- [ ] **Step 6: Commit**

```bash
git add src/metrics.ts tests/routing.test.ts package.json
git commit -m "feat(metrics): attribute each request to an account, per-pair cost query"
```

---

### Task 7: `selectAccountFor()` — luật chọn account

Đây là task trung tâm của cả kế hoạch. Hàm phải **thuần** (chỉ đọc DB, không I/O mạng, không đụng `res`) để test được trực tiếp.

**Files:**
- Modify: `src/accounts.ts` (thêm `selectAccountFor`)
- Test: `tests/routing.test.ts` (nối thêm)

**Interfaces:**
- Consumes: `listBindings` (Task 2), `getAccountRow` (Task 2), `getAccessTokenFor`/`isUsable` (Task 5), `getClientAccountCostSince`/`periodStart` (Task 6)
- Produces:
  ```ts
  export type BlockedBinding = {
    accountId: string; usedUsd: number; limitUsd: number; limitPeriod: LimitPeriod
  }
  export type SelectResult =
    | { ok: true; accountId: string; accessToken: string; row: AccountRow }
    | { ok: false; reason: 'no-bindings' }
    | { ok: false; reason: 'quota'; blocked: BlockedBinding[] }
    | { ok: false; reason: 'unavailable' }

  export function selectAccountFor(clientName: string, billable: boolean): SelectResult
  ```

`billable = false` (đường `/v1/*` không tính tiền) bỏ qua bước kiểm tra hạn mức và chỉ cần một account đang sống.

- [ ] **Step 1: Viết test thất bại**

Nối vào `tests/routing.test.ts`, **trước** dòng đếm kết quả:

```ts
import {
  createAccount, selectAccountFor, _resetAccountsRuntime,
} from '../src/accounts.js'
import {
  updateAccountRow, insertClientRow, replaceBindings,
} from '../src/accounts-store.js'

console.log('\nrouting - selectAccountFor\n')

const HOUR = 60 * 60 * 1000

function makeLiveAccount(id: string) {
  createAccount({ id })
  updateAccountRow(id, {
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAt: Date.now() + HOUR,
    state: 'ok',
  })
}

_resetAccountsRuntime()
makeLiveAccount('acc-a')
makeLiveAccount('acc-b')
makeLiveAccount('acc-c')
insertClientRow({ name: 'carol', token: 'tok-carol' })

test('chọn account có priority nhỏ nhất', () => {
  replaceBindings('carol', [
    { accountId: 'acc-b', priority: 9, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'acc-a')
  assert.equal(r.ok && r.accessToken, 'token-acc-a')
})

test('hết hạn mức thì tràn xuống account kế tiếp', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'acc-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('carol', 'acc-a', 10)
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-b')
})

test('limitUsd = 0 là không giới hạn, không phải chặn', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-a')
})

test('cạn mọi account → reason quota, liệt kê đủ used/limit', () => {
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 10, limitPeriod: 'lifetime' },
    { accountId: 'acc-b', priority: 2, limitUsd: 5, limitPeriod: 'lifetime' },
  ])
  spend('carol', 'acc-b', 5)
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'quota')
  const blocked = !r.ok && r.reason === 'quota' ? r.blocked : []
  assert.equal(blocked.length, 2)
  assert.deepEqual(blocked.map((b) => b.accountId).sort(), ['acc-a', 'acc-b'])
  assert.equal(blocked.find((b) => b.accountId === 'acc-a')!.usedUsd, 10)
  assert.equal(blocked.find((b) => b.accountId === 'acc-a')!.limitUsd, 10)
})

test('đường không tính tiền vẫn đi được dù cạn hạn mức', () => {
  const r = selectAccountFor('carol', false)
  assert.equal(r.ok, true)
  assert.equal(r.ok && r.accountId, 'acc-a')
})

test('bỏ qua account expired, dùng cái kế tiếp', () => {
  updateAccountRow('acc-a', { state: 'expired', accessToken: '', expiresAt: 0 })
  replaceBindings('carol', [
    { accountId: 'acc-a', priority: 1, limitUsd: 0, limitPeriod: 'lifetime' },
    { accountId: 'acc-c', priority: 2, limitUsd: 0, limitPeriod: 'lifetime' },
  ])
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok && r.accountId, 'acc-c')
})

test('bỏ qua account bị tắt', () => {
  updateAccountRow('acc-c', { enabled: false })
  const r = selectAccountFor('carol', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'unavailable')
  updateAccountRow('acc-c', { enabled: true })
})

test('client không có binding → reason no-bindings', () => {
  insertClientRow({ name: 'dave', token: 'tok-dave' })
  const r = selectAccountFor('dave', true)
  assert.equal(r.ok, false)
  assert.equal(!r.ok && r.reason, 'no-bindings')
})

test('hạn mức hết hạn theo chu kỳ: daily tính lại từ đầu ngày UTC', () => {
  insertClientRow({ name: 'erin', token: 'tok-erin' })
  replaceBindings('erin', [
    { accountId: 'acc-b', priority: 1, limitUsd: 1, limitPeriod: 'daily' },
  ])
  // Yesterday's spend must not count against today's daily limit.
  recordRequest({
    ts: Date.now() - 48 * HOUR,
    client: 'erin',
    accountId: 'acc-b',
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    durationMs: 1,
    costUsd: 99,
  })
  const r = selectAccountFor('erin', true)
  assert.equal(r.ok && r.accountId, 'acc-b')
})
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/routing.test.ts`
Expected: FAIL — `selectAccountFor is not a function`

- [ ] **Step 3: Thêm `selectAccountFor` vào `src/accounts.ts`**

Thêm import ở đầu file:

```ts
import { listBindings } from './accounts-store.js'
import type { BindingRow, LimitPeriod } from './accounts-store.js'
import { getClientAccountCostSince, periodStart } from './metrics.js'
```

Và cuối file:

```ts
export type BlockedBinding = {
  accountId: string
  usedUsd: number
  limitUsd: number
  limitPeriod: LimitPeriod
}

export type SelectResult =
  | { ok: true; accountId: string; accessToken: string; row: AccountRow }
  | { ok: false; reason: 'no-bindings' }
  | { ok: false; reason: 'quota'; blocked: BlockedBinding[] }
  | { ok: false; reason: 'unavailable' }

/**
 * Pick the account a client's next request should spend against.
 *
 * Walks the client's bindings in priority order (lower first) and takes the
 * first one that is both alive and still inside its quota. There is no failover
 * on upstream errors — a 429/401 from the API surfaces to the client, and the
 * dead account only drops out on the NEXT call, once its state has been updated.
 *
 * `billable` is false for the free endpoints (settings, event logging, …), which
 * must not be gated on a spending limit.
 */
export function selectAccountFor(clientName: string, billable: boolean): SelectResult {
  const bindings = listBindings(clientName)
  if (bindings.length === 0) return { ok: false, reason: 'no-bindings' }

  const blocked: BlockedBinding[] = []

  for (const binding of bindings) {
    const row = getAccountRow(binding.accountId)
    if (!row) continue

    const accessToken = getAccessTokenFor(binding.accountId)
    if (!accessToken) continue

    if (billable && binding.limitUsd > 0) {
      const used = getClientAccountCostSince(
        clientName,
        binding.accountId,
        periodStart(binding.limitPeriod),
      )
      if (used >= binding.limitUsd) {
        blocked.push({
          accountId: binding.accountId,
          usedUsd: used,
          limitUsd: binding.limitUsd,
          limitPeriod: binding.limitPeriod,
        })
        continue
      }
    }

    return { ok: true, accountId: binding.accountId, accessToken, row }
  }

  // Quota wins over availability in the report: a client that burned through
  // every limit needs a different message than one whose accounts all died.
  if (blocked.length > 0) return { ok: false, reason: 'quota', blocked }
  return { ok: false, reason: 'unavailable' }
}
```

Bỏ luôn biến `sawLiveAccount` trong vòng lặp — nó không được dùng tới, vì `blocked.length` đã phân biệt đủ hai trường hợp.

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/routing.test.ts`
Expected: PASS — 14 passed, 0 failed

- [ ] **Step 5: Kiểm tra vòng import**

`accounts.ts` giờ import `metrics.ts`, và `metrics.ts` import `db.ts` + `preview.ts` + `ratelimit.ts` — không cái nào import ngược `accounts.ts`.

Run: `npx tsc --noEmit && npm test`
Expected: không lỗi kiểu, mọi suite PASS

- [ ] **Step 6: Commit**

```bash
git add src/accounts.ts tests/routing.test.ts
git commit -m "feat(routing): priority-ordered account selection with per-pair quota"
```

---

### Task 8: `Config` hiệu dụng theo account

`rewriter.ts` nhận `config: Config` qua 16 hàm. Thay vì luồn thêm tham số account qua từng hàm, ta dựng một `Config` hiệu dụng cho mỗi request. `rewriter.ts` **không phải sửa dòng nào**.

**Files:**
- Create: `src/effective-config.ts`
- Test: `tests/effective-config.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `AccountRow` (Task 2), `Config` từ `src/config.ts`
- Produces:
  ```ts
  export function effectiveConfigFor(base: Config, account: AccountRow): Config
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/effective-config.test.ts`:

```ts
import { strict as assert } from 'assert'
import { effectiveConfigFor } from '../src/effective-config.js'
import type { Config } from '../src/config.js'
import type { AccountRow } from '../src/accounts-store.js'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

const base = {
  upstream: { url: 'https://api.anthropic.com' },
  identity: { device_id: 'ba'.repeat(32), email: 'base@example.com' },
  env: { platform: 'darwin', arch: 'arm64', terminal: 'iTerm2.app' },
  prompt_env: { platform: 'darwin', shell: 'zsh', os_version: 'Darwin 24.4.0', working_dir: '/Users/dev' },
} as unknown as Config

function account(patch: Partial<AccountRow>): AccountRow {
  return {
    id: 'acc', label: '', refreshToken: '', accessToken: '', expiresAt: 0,
    state: 'ok', lastError: '', lastRefreshAt: 0,
    deviceId: 'aa'.repeat(32), email: 'acc@example.com',
    env: null, promptEnv: null, enabled: true, createdAt: 0,
    ...patch,
  }
}

console.log('\neffective-config\n')

test('device_id và email lấy từ account', () => {
  const cfg = effectiveConfigFor(base, account({}))
  assert.equal(cfg.identity.device_id, 'aa'.repeat(32))
  assert.equal(cfg.identity.email, 'acc@example.com')
})

test('env rỗng thì kế thừa config gốc', () => {
  const cfg = effectiveConfigFor(base, account({ env: null }))
  assert.deepEqual(cfg.env, base.env)
  assert.deepEqual(cfg.prompt_env, base.prompt_env)
})

test('env của account ghi đè theo từng khoá, không thay cả khối', () => {
  const cfg = effectiveConfigFor(base, account({ env: { terminal: 'Apple_Terminal' } }))
  assert.equal(cfg.env.terminal, 'Apple_Terminal')
  assert.equal(cfg.env.platform, 'darwin')
  assert.equal(cfg.env.arch, 'arm64')
})

test('prompt_env của account ghi đè theo từng khoá', () => {
  const cfg = effectiveConfigFor(base, account({ promptEnv: { shell: 'bash' } }))
  assert.equal(cfg.prompt_env.shell, 'bash')
  assert.equal(cfg.prompt_env.working_dir, '/Users/dev')
})

test('không làm bẩn config gốc', () => {
  effectiveConfigFor(base, account({ env: { terminal: 'X' } }))
  assert.equal(base.identity.device_id, 'ba'.repeat(32))
  assert.equal(base.env.terminal, 'iTerm2.app')
})

test('email rỗng của account thì giữ email gốc', () => {
  const cfg = effectiveConfigFor(base, account({ email: '' }))
  assert.equal(cfg.identity.email, 'base@example.com')
})

test('hai account cho ra hai config khác nhau', () => {
  const a = effectiveConfigFor(base, account({ deviceId: '11'.repeat(32) }))
  const b = effectiveConfigFor(base, account({ deviceId: '22'.repeat(32) }))
  assert.notEqual(a.identity.device_id, b.identity.device_id)
  assert.equal(a.upstream.url, b.upstream.url)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/effective-config.test.ts`
Expected: FAIL — `Cannot find module '../src/effective-config.js'`

- [ ] **Step 3: Viết `src/effective-config.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/effective-config.test.ts`
Expected: PASS — 7 passed, 0 failed

- [ ] **Step 5: Nối vào `npm test`**

Thêm ` && tsx tests/effective-config.test.ts` vào script `test`.

Run: `npm test && npx tsc --noEmit`
Expected: mọi suite PASS, không lỗi kiểu

- [ ] **Step 6: Commit**

```bash
git add src/effective-config.ts tests/effective-config.test.ts package.json
git commit -m "feat(identity): per-account effective config for the rewriter"
```

---

### Task 9: `auth.ts` đọc client từ DB

**Files:**
- Modify: `src/auth.ts` (toàn bộ)
- Modify: `src/index.ts` (bỏ `watchFile` phần `auth.tokens`, gọi `reloadClients()`)
- Test: `tests/routing.test.ts` (nối thêm)

**Interfaces:**
- Consumes: `listClientRows` (Task 2)
- Produces:
  ```ts
  export type ClientEntry = { name: string; token: string; homeDir: string }
  export function reloadClients(): void
  export function lookupToken(token: string): ClientEntry | null
  export function authenticate(req: IncomingMessage): ClientEntry | null
  ```

`TokenEntry` (từ `config.ts`) không còn là kiểu trả về — `cost_limit_usd`/`cost_limit_period` giờ nằm ở binding, không ở client.

- [ ] **Step 1: Viết test thất bại**

Nối vào `tests/routing.test.ts`:

```ts
import { reloadClients, lookupToken } from '../src/auth.js'

console.log('\nauth - client nạp từ DB\n')

test('lookupToken thấy client vừa thêm sau reload', () => {
  reloadClients()
  const entry = lookupToken('tok-carol')
  assert.ok(entry)
  assert.equal(entry!.name, 'carol')
})

test('token lạ trả về null', () => {
  assert.equal(lookupToken('khong-ton-tai'), null)
  assert.equal(lookupToken(''), null)
})

test('client bị xoá biến mất sau reload', () => {
  insertClientRow({ name: 'temp', token: 'tok-temp' })
  reloadClients()
  assert.ok(lookupToken('tok-temp'))
  deleteClientRow('temp')
  reloadClients()
  assert.equal(lookupToken('tok-temp'), null)
})
```

Thêm `deleteClientRow` vào import từ `accounts-store.js`.

- [ ] **Step 2: Chạy test để xác nhận nó fail**

Run: `npx tsx tests/routing.test.ts`
Expected: FAIL — `reloadClients is not a function`

- [ ] **Step 3: Viết lại `src/auth.ts`**

```ts
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
```

- [ ] **Step 3b: Nới lỏng `auth` trong `src/config.ts`**

Đến đây client đã nằm hẳn trong DB, nên `auth.tokens` không còn người đọc bắt buộc:

```ts
  auth?: {
    tokens: TokenEntry[]
  }
```

Xoá luôn khối `throw` cho `auth.tokens` rỗng, và nới lỏng kiểm tra `identity.device_id`
(nó giờ chỉ là mẫu cho account mới, không phải danh tính đang dùng):

```ts
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
```

- [ ] **Step 4: Sửa `src/index.ts`**

Thay `initAuth(config)` bằng `reloadClients()`. Trong khối `watchFile`, **xoá** phần `lastTokenSig` / `initAuth(next)` / log `Reloaded auth.tokens`, giữ lại phần đồng bộ `env.version`:

```ts
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
```

- [ ] **Step 5: Sửa log khởi động trong `startProxy`**

`src/proxy.ts:81-83` đang log `config.identity.device_id` (giờ chỉ là mẫu, không phải danh tính đang dùng) và `config.auth.tokens` (giờ là tuỳ chọn, sẽ `undefined` trên cài đặt mới → crash lúc khởi động). Thay hai dòng đó:

```ts
  server.listen(config.server.port, () => {
    log('info', `CC Gateway listening on ${useTls ? 'https' : 'http'}://0.0.0.0:${config.server.port}`)
    log('info', `Upstream: ${config.upstream.url}`)
    const clients = listClientRows()
    log('info', `Accounts: ${listAccountRows().length}, clients: ${clients.length}`)
    if (clients.length > 0) {
      log('info', `Authorized clients: ${clients.map((c) => c.name).join(', ')}`)
    }
  })
```

Thêm `import { listAccountRows, listClientRows } from './accounts-store.js'` vào `src/proxy.ts`.

- [ ] **Step 6: Chạy test để xác nhận nó pass**

Run: `npx tsx tests/routing.test.ts`
Expected: PASS — 17 passed, 0 failed

- [ ] **Step 7: Kiểm tra kiểu**

Run: `npx tsc --noEmit`
Expected: sẽ còn lỗi ở `src/proxy.ts` (nó vẫn đọc `tokenEntry.cost_limit_usd`) và `src/portal.ts` — **đây là dự kiến**, Task 10 sửa. Ghi lại danh sách lỗi để Task 10 đối chiếu.

- [ ] **Step 8: Commit**

```bash
git add src/auth.ts src/index.ts tests/routing.test.ts
git commit -m "feat(auth): load clients from the DB instead of config.yaml"
```

---

### Task 10: Nối routing vào `proxy.ts`

**Files:**
- Modify: `src/proxy.ts:160-200` (auth + cost limit), `:251-266` (rewrite + header), `:180-215` và các chỗ `recordRequest`
- Modify: `src/portal.ts` (chỗ đọc `cost_limit_usd`)
- Modify: `src/i18n.ts` (chuỗi lỗi mới)

**Interfaces:**
- Consumes: `authenticate` (Task 9), `selectAccountFor` (Task 7), `effectiveConfigFor` (Task 8), `recordRequest` với `accountId` (Task 6)
- Produces: không có export mới

- [ ] **Step 1: Thay khối auth + hạn mức**

Trong `handleRequest` của `src/proxy.ts`, thay toàn bộ khối "Cost limit enforcement" (dòng 170-199) bằng:

```ts
  const billable = pathname.startsWith('/v1/messages')
  const selected = selectAccountFor(clientName, billable)

  if (!selected.ok) {
    const status = selected.reason === 'quota' ? 429 : 503
    const payload =
      selected.reason === 'quota'
        ? {
            error: 'Cost limit reached on every account',
            client: clientName,
            accounts: selected.blocked.map((b) => ({
              account: b.accountId,
              period: b.limitPeriod,
              used_usd: Number(b.usedUsd.toFixed(4)),
              limit_usd: b.limitUsd,
            })),
          }
        : selected.reason === 'no-bindings'
          ? {
              error: 'No upstream account assigned to this client',
              client: clientName,
              hint: 'Assign one from the admin dashboard → Clients → Accounts',
            }
          : {
              error: 'No usable upstream account',
              client: clientName,
              hint: 'Every assigned account is disabled or needs re-login',
            }

    const detail =
      selected.reason === 'quota'
        ? `cost limit reached on all ${selected.blocked.length} account(s)`
        : selected.reason === 'no-bindings'
          ? 'client has no account bindings'
          : 'no usable account'

    res.writeHead(status, {
      'Content-Type': 'application/json',
      'x-ccg-error': selected.reason === 'quota' ? 'cost-limit' : 'no-account',
    })
    res.end(JSON.stringify(payload))
    log('warn', `Client "${clientName}" blocked: ${detail}`)
    recordRequest({
      ts: startedAt,
      client: clientName,
      method,
      path: pathname,
      status,
      durationMs: Date.now() - startedAt,
      errorSource: 'gateway',
      errorDetail: detail,
    })
    if (config.logging.audit) audit(clientName, method, path, status)
    return
  }

  const accountId = selected.accountId
  // Identity/env for THIS request belong to the chosen account, not the gateway.
  const reqConfig = effectiveConfigFor(config, selected.row)
```

- [ ] **Step 2: Dùng `reqConfig` cho rewrite, `selected.accessToken` cho forward**

Ở dòng 251 đổi `rewriteBody(body, path, config, rewriteInfo)` → `rewriteBody(body, path, reqConfig, rewriteInfo)`.

Ở `rewriteHeaders(...)` (dòng 258) đổi tham số `config` → `reqConfig`, và thay chỗ lấy access token bằng `selected.accessToken` (bỏ khối tạm thời đã thêm ở Task 5 Step 5).

Mọi chỗ khác trong hàm dùng `config` cho rewriting (tìm bằng `grep -n "config" src/proxy.ts` trong thân `handleRequest`) đổi sang `reqConfig`. `config.logging`, `config.server`, `config.upstream` **giữ nguyên** `config` — chúng không phụ thuộc account.

- [ ] **Step 3: Gắn `accountId` vào mọi `recordRequest` sau khi đã chọn account**

Tìm mọi lời gọi `recordRequest({` nằm **sau** dòng chọn account và thêm `accountId,` ngay sau `client: clientName,`.

Run: `grep -n "recordRequest({" src/proxy.ts`
Đối chiếu từng chỗ: nằm trước lúc chọn account thì bỏ qua, nằm sau thì phải có `accountId`.

- [ ] **Step 4: Sửa các chỗ vỡ kiểu**

`tokenEntry.cost_limit_usd` và `.cost_limit_period` không còn tồn tại. Trong `src/portal.ts`, thay chỗ hiển thị hạn mức phẳng bằng tổng hợp theo binding:

```ts
import { listBindings } from './accounts-store.js'
import { getClientAccountCostSince } from './metrics.js'
import { periodStart } from './metrics.js'

const quotas = listBindings(clientName).map((b) => ({
  account: b.accountId,
  period: b.limitPeriod,
  limit_usd: b.limitUsd,
  used_usd: Number(getClientAccountCostSince(clientName, b.accountId, periodStart(b.limitPeriod)).toFixed(4)),
}))
```

Rồi render danh sách này thay cho một con số. Thêm khoá i18n, **đủ ba ngôn ngữ**:

```ts
  'portal.quotaPerAccount': {
    en: 'Quota per account', vi: 'Hạn mức theo tài khoản', zh: '各账户限额',
  },
```

`tokenEntry.home_dir` đổi thành `tokenEntry.homeDir`.

- [ ] **Step 5: Kiểm tra kiểu sạch**

Run: `npx tsc --noEmit`
Expected: **không còn lỗi nào** — mọi lỗi ghi lại ở Task 9 Step 6 phải đã hết

- [ ] **Step 6: Chạy toàn bộ test**

Run: `npm test`
Expected: mọi suite PASS

- [ ] **Step 7: Khói thử bằng tay**

```bash
rm -rf /tmp/ccg-smoke && mkdir -p /tmp/ccg-smoke
npx tsx src/index.ts /tmp/ccg-smoke/config.yaml
```

Expected: gateway khởi động, log `No upstream accounts configured`, không crash. `curl -sk https://localhost:8443/_health` (hoặc http tuỳ cấu hình TLS) trả 200. Dừng bằng Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add src/proxy.ts src/portal.ts src/i18n.ts
git commit -m "feat(proxy): route each request to its client's account"
```

---

### Task 11: API quản lý account

**Files:**
- Modify: `src/proxy.ts` (`handleDashboardArea`, dòng 750-827 — thay khối `/api/oauth`)

**Interfaces:**
- Consumes: `listAccounts`, `getAccountView`, `createAccount`, `updateAccount`, `deleteAccount`, `beginLogin`, `completeLogin`, `cancelLogin` (Task 5); `listBindingsForAccount` (Task 2)
- Produces: bảy endpoint dưới đây

- [ ] **Step 1: Luồn `config` vào `handleDashboardArea`**

`handleDashboardArea(req, res, pathname, method)` (`src/proxy.ts:636`) **không** nhận `config` — nó là tham số của `handleRequest`. Endpoint tạo account cần `config.identity.email` làm mặc định, nên thêm tham số trước đã:

```ts
async function handleDashboardArea(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  config: Config,
) {
```

Và ở chỗ gọi (`src/proxy.ts:136`): `await handleDashboardArea(req, res, pathname, method, config)`.

Không đổi `handlePortalArea` — nó chưa cần `config`.

- [ ] **Step 2: Thêm endpoint đọc**

Thay khối `if (pathname === '/api/oauth')` bằng:

```ts
  if (pathname === '/api/accounts' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ accounts: listAccounts() }))
    return
  }
```

- [ ] **Step 3: Thêm endpoint tạo**

```ts
  if (pathname === '/api/accounts' && method === 'POST') {
    let body: Buffer
    try {
      body = await readBody(req)
    } catch {
      res.writeHead(413, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Payload too large' }))
      return
    }
    try {
      const input = JSON.parse(body.toString('utf-8')) as {
        id?: string; label?: string; email?: string
      }
      if (!input.id) throw new Error('id is required')
      const account = createAccount({
        id: input.id,
        label: input.label,
        email: input.email || config.identity.email,
      })
      log('info', `Account "${account.id}" created`)
      res.writeHead(201, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(account))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(message.includes('already exists') ? 409 : 400, {
        'Content-Type': 'application/json',
      })
      res.end(JSON.stringify({ error: message }))
    }
    return
  }
```

- [ ] **Step 4: Thêm PATCH / DELETE / login / complete / cancel**

```ts
  if (pathname.startsWith('/api/accounts/')) {
    const rest = pathname.slice('/api/accounts/'.length)
    const [id, action] = rest.split('/')
    if (!id) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    if (!getAccountView(id)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `No such account: ${id}` }))
      return
    }

    const fail = (status: number, err: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }

    if (!action && method === 'PATCH') {
      let body: Buffer
      try {
        body = await readBody(req)
      } catch {
        return fail(413, new Error('Payload too large'))
      }
      try {
        const patch = JSON.parse(body.toString('utf-8'))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(updateAccount(id, patch)))
      } catch (err) {
        fail(400, err)
      }
      return
    }

    if (!action && method === 'DELETE') {
      try {
        deleteAccount(id)
        log('info', `Account "${id}" deleted`)
        res.writeHead(204)
        res.end()
      } catch (err) {
        // still bound to clients
        fail(409, err)
      }
      return
    }

    if (action === 'login' && method === 'POST') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(beginLogin(id)))
      } catch (err) {
        fail(400, err)
      }
      return
    }

    if (action === 'complete' && method === 'POST') {
      let body: Buffer
      try {
        body = await readBody(req)
      } catch {
        return fail(413, new Error('Payload too large'))
      }
      try {
        const { code } = JSON.parse(body.toString('utf-8')) as { code?: string }
        if (!code) throw new Error('code is required')
        const done = await completeLogin(id, code)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(done))
      } catch (err) {
        fail(400, err)
      }
      return
    }

    if (action === 'cancel' && method === 'POST') {
      cancelLogin(id)
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(405, { Allow: 'PATCH, DELETE, POST' })
    res.end()
    return
  }
```

- [ ] **Step 5: Cập nhật bảng định tuyến**

Ở khối điều kiện dòng 123-135, thay hai dòng `/api/oauth` bằng:

```ts
    pathname === '/api/accounts' ||
    pathname.startsWith('/api/accounts/') ||
```

- [ ] **Step 6: Cập nhật `/_metrics`**

Đổi `oauth: getOAuthStatus()` thành `accounts: listAccounts()`.

- [ ] **Step 7: Kiểm tra bằng tay**

```bash
rm -rf /tmp/ccg-api && mkdir -p /tmp/ccg-api
npx tsx src/index.ts /tmp/ccg-api/config.yaml &
sleep 2
npx tsx src/scripts/add-user.ts admin   # tạo admin để có session
```

Đăng nhập `/admin` bằng trình duyệt rồi lấy cookie, và:

```bash
curl -s -b "ccg_session=<cookie>" localhost:8443/api/accounts
curl -s -b "ccg_session=<cookie>" -X POST localhost:8443/api/accounts \
  -H 'Content-Type: application/json' -d '{"id":"pro-1","label":"Pro 1"}'
curl -s -b "ccg_session=<cookie>" -X POST localhost:8443/api/accounts/pro-1/login
```

Expected: lần lượt `{"accounts":[]}`, `201` với account mới, và một URL `claude.com/cai/oauth/authorize?...`. Dừng tiến trình.

- [ ] **Step 8: Kiểm tra kiểu và test**

Run: `npx tsc --noEmit && npm test`
Expected: sạch, mọi suite PASS

- [ ] **Step 9: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(api): account CRUD and per-account OAuth login endpoints"
```

---

### Task 12: API gán account cho client

**Files:**
- Modify: `src/proxy.ts` (`handleDashboardArea`, khối `/api/clients/`)
- Modify: `src/clients.ts` (`addClient`, `removeClient`, `listClients` chuyển sang DB)

**Interfaces:**
- Consumes: `listBindings`, `replaceBindings`, `insertClientRow`, `deleteClientRow`, `listClientRows`, `getAccountRow` (Task 2); `reloadClients` (Task 9)
- Produces:
  ```ts
  // src/clients.ts
  export function listClients(): ClientEntry[]        // giờ đọc DB
  export function addClient(name: string): ClientEntry
  export function removeClient(name: string): boolean
  export function setClientHomeDir(name: string, homeDir: string | null): ClientEntry
  ```

Các hàm `buildLauncherScript`, `buildUnixInstaller`, `buildPowerShellInstaller` trong `src/clients.ts` **không đổi** — chúng chỉ nhận `LauncherOptions`.

- [ ] **Step 1: Chuyển `clients.ts` sang DB**

Thay `configPath()`, `loadDoc()`, `getTokensSeq()`, `readEntry()`, `applyLimitToYamlEntry()` và phần YAML của `listClients`/`addClient`/`setClientLimit`/`removeClient`/`setClientHomeDir` bằng lời gọi `accounts-store`:

```ts
import { randomBytes } from 'crypto'
import {
  listClientRows, getClientRow, insertClientRow, deleteClientRow,
} from './accounts-store.js'
import { reloadClients } from './auth.js'

export type ClientEntry = {
  name: string
  token: string
  home_dir?: string
}

export function listClients(): ClientEntry[] {
  return listClientRows().map((r) => ({
    name: r.name,
    token: r.token,
    home_dir: r.homeDir || undefined,
  }))
}

export function addClient(name: string): ClientEntry {
  if (getClientRow(name)) throw new Error(`Client "${name}" already exists`)
  const row = insertClientRow({ name, token: randomBytes(32).toString('hex') })
  reloadClients()
  return { name: row.name, token: row.token, home_dir: row.homeDir || undefined }
}

export function removeClient(name: string): boolean {
  if (!getClientRow(name)) return false
  deleteClientRow(name)   // bindings cascade
  reloadClients()
  return true
}

export function setClientHomeDir(name: string, homeDir: string | null): ClientEntry {
  const normalized = homeDir ? normalizeHomeDir(homeDir) : null
  getDb()
    .prepare('UPDATE clients SET home_dir = ? WHERE name = ?')
    .run(normalized || '', name)
  reloadClients()
  const row = getClientRow(name)
  if (!row) throw new Error(`No such client: ${name}`)
  return { name: row.name, token: row.token, home_dir: row.homeDir || undefined }
}
```

`setClientLimit` bị xoá — hạn mức giờ là thuộc tính của binding, đặt qua `PUT /api/clients/:name/accounts`. Xoá luôn `applyLimitToYamlEntry` và type `ClientLimitInput`; sửa mọi chỗ gọi trong `src/proxy.ts` và `src/dashboard.ts`.

`normalizeHomeDir` giữ nguyên. Thêm `import { getDb } from './db.js'`.

- [ ] **Step 2: Thêm hai endpoint binding**

Trong khối `if (pathname.startsWith('/api/clients/'))` của `src/proxy.ts`, thêm nhánh:

```ts
    if (rest.endsWith('/accounts')) {
      const clientName = decodeURIComponent(rest.slice(0, -'/accounts'.length))
      if (!listClients().some((c) => c.name === clientName)) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `No such client: ${clientName}` }))
        return
      }

      if (method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ bindings: listBindings(clientName) }))
        return
      }

      if (method === 'PUT') {
        let body: Buffer
        try {
          body = await readBody(req)
        } catch {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Payload too large' }))
          return
        }
        try {
          const parsed = JSON.parse(body.toString('utf-8')) as {
            bindings?: Array<{
              account_id?: string; priority?: number
              limit_usd?: number; limit_period?: string
            }>
          }
          const rows = (parsed.bindings || []).map((b, index) => {
            if (!b.account_id) throw new Error('account_id is required on every binding')
            if (!getAccountRow(b.account_id)) {
              throw new Error(`No such account: ${b.account_id}`)
            }
            const period = b.limit_period || 'lifetime'
            if (!['lifetime', 'monthly', 'daily'].includes(period)) {
              throw new Error(`Invalid limit_period: ${period}`)
            }
            const limit = Number(b.limit_usd ?? 0)
            if (!Number.isFinite(limit) || limit < 0) {
              throw new Error(`Invalid limit_usd: ${b.limit_usd}`)
            }
            return {
              accountId: b.account_id,
              priority: Number(b.priority ?? index),
              limitUsd: limit,
              limitPeriod: period as LimitPeriod,
            }
          })
          const seen = new Set(rows.map((r) => r.accountId))
          if (seen.size !== rows.length) {
            throw new Error('An account may appear at most once per client')
          }
          replaceBindings(clientName, rows)
          log('info', `Client "${clientName}" bound to ${rows.length} account(s)`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ bindings: listBindings(clientName) }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
        return
      }

      res.writeHead(405, { Allow: 'GET, PUT' })
      res.end()
      return
    }
```

Đặt nhánh này **trước** các nhánh xử lý `/api/clients/:name` khác, để `rest` không bị khớp nhầm.

Thêm vào đầu `src/proxy.ts`:

```ts
import { listBindings, replaceBindings, getAccountRow } from './accounts-store.js'
import type { LimitPeriod } from './accounts-store.js'
```

- [ ] **Step 3: Kiểm tra bằng tay**

Khởi động như Task 11, rồi:

```bash
curl -s -b "$C" -X POST localhost:8443/api/clients -H 'Content-Type: application/json' -d '{"name":"alice"}'
curl -s -b "$C" -X PUT localhost:8443/api/clients/alice/accounts \
  -H 'Content-Type: application/json' \
  -d '{"bindings":[{"account_id":"pro-1","priority":1,"limit_usd":10,"limit_period":"monthly"}]}'
curl -s -b "$C" localhost:8443/api/clients/alice/accounts
```

Expected: binding được ghi và đọc lại đúng. Gửi `account_id` không tồn tại → 400 với thông báo rõ. Gửi cùng một `account_id` hai lần → 400.

- [ ] **Step 4: Kiểm tra kiểu và test**

Run: `npx tsc --noEmit && npm test`
Expected: sạch, mọi suite PASS

- [ ] **Step 5: Commit**

```bash
git add src/clients.ts src/proxy.ts src/dashboard.ts
git commit -m "feat(api): client-to-account bindings, clients move to the DB"
```

---

### Task 13: Mục Accounts trên dashboard

Dashboard **không dùng tab** — nó là sidebar (`aside.sidebar nav a`, `src/dashboard.ts:101-124`). Và i18n chạy **phía trình duyệt**: HTML gắn `data-i18n`, JS gọi `window.t()`. Task này bám đúng hai điều đó.

**Files:**
- Create: `src/dashboard-accounts.ts`
- Modify: `src/dashboard.ts` (chỉ thêm mục sidebar + chèn section, không nhồi logic)
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/:id`, `POST /api/accounts/:id/{login,complete,cancel}` (Task 11)
- Produces:
  ```ts
  export function renderAccountsSection(): string   // HTML, chuỗi đã dịch dùng data-i18n
  export function accountsScript(): string          // thân <script>, dùng window.t()
  ```

- [ ] **Step 1: Thêm khoá i18n (đủ ba ngôn ngữ)**

Chèn vào từ điển `M` trong `src/i18n.ts`, thành một nhóm `── admin accounts ──`:

```ts
  // ── admin accounts ──
  'acct.nav': { en: 'Accounts', vi: 'Tài khoản', zh: '账户' },
  'acct.title': { en: 'Upstream accounts', vi: 'Tài khoản upstream', zh: '上游账户' },
  'acct.add': { en: 'Add account', vi: 'Thêm tài khoản', zh: '添加账户' },
  'acct.id': { en: 'ID', vi: 'ID', zh: 'ID' },
  'acct.label': { en: 'Label', vi: 'Nhãn', zh: '名称' },
  'acct.state': { en: 'State', vi: 'Trạng thái', zh: '状态' },
  'acct.expires': { en: 'Token expires', vi: 'Token hết hạn', zh: '令牌到期' },
  'acct.deviceId': { en: 'Device ID', vi: 'Device ID', zh: '设备 ID' },
  'acct.email': { en: 'Email', vi: 'Email', zh: '邮箱' },
  'acct.enabled': { en: 'Enabled', vi: 'Đang bật', zh: '已启用' },
  'acct.relogin': { en: 'Re-login', vi: 'Đăng nhập lại', zh: '重新登录' },
  'acct.delete': { en: 'Delete', vi: 'Xoá', zh: '删除' },
  'acct.none': {
    en: 'No accounts yet - add one to start proxying',
    vi: 'Chưa có tài khoản nào - thêm một cái để bắt đầu',
    zh: '还没有账户 - 添加一个即可开始代理',
  },
  'acct.idPlaceholder': { en: 'e.g. pro-1', vi: 'ví dụ: pro-1', zh: '例如 pro-1' },
  'acct.loginStep1': {
    en: 'Open this URL, approve, then paste the code back here',
    vi: 'Mở URL này, chấp thuận, rồi dán mã trả về vào đây',
    zh: '打开此链接并授权，然后把代码粘贴回来',
  },
  'acct.loginStep2': { en: 'Paste the code', vi: 'Dán mã vào đây', zh: '粘贴代码' },
  'acct.loginSubmit': { en: 'Finish login', vi: 'Hoàn tất đăng nhập', zh: '完成登录' },
  'acct.stateOk': { en: 'Active', vi: 'Hoạt động', zh: '正常' },
  'acct.stateExpired': { en: 'Needs re-login', vi: 'Cần đăng nhập lại', zh: '需要重新登录' },
  'acct.stateRefreshing': { en: 'Refreshing', vi: 'Đang làm mới', zh: '刷新中' },
  'acct.stateUninitialized': { en: 'Not logged in', vi: 'Chưa đăng nhập', zh: '未登录' },
  'acct.inUseBy': { en: 'Still used by: {names}', vi: 'Đang được dùng bởi: {names}', zh: '仍被使用：{names}' },
```

Khoá `acct.state<State>` cố ý trùng tên với bốn giá trị của `AccountState` viết hoa chữ đầu, để JS tra thẳng: `t('acct.state' + s[0].toUpperCase() + s.slice(1))`.

- [ ] **Step 2: Kiểm tra khoá đủ ba ngôn ngữ**

Run: `npx tsc --noEmit`
Expected: sạch. Thiếu `zh` ở bất kỳ khoá nào sẽ báo lỗi kiểu ngay, vì `Entry = Record<Locale, string>`.

- [ ] **Step 3: Viết `src/dashboard-accounts.ts`**

```ts
// Accounts section of the admin dashboard. Kept in its own file because
// dashboard.ts is already past 2000 lines; everything account-related lives
// here so the two can be read independently.

/** Markup only. Every visible string is resolved in the browser via data-i18n. */
export function renderAccountsSection(): string {
  return `
<section id="accounts" class="panel-section">
  <header class="section-head">
    <h2 data-i18n="acct.title">Upstream accounts</h2>
    <form id="acct-add" class="inline-form">
      <input name="id" required pattern="[A-Za-z0-9][A-Za-z0-9-]{0,63}"
             data-i18n-ph="acct.idPlaceholder" placeholder="e.g. pro-1" />
      <input name="label" data-i18n-ph="acct.label" placeholder="Label" />
      <button type="submit" data-i18n="acct.add">Add account</button>
    </form>
  </header>
  <div id="acct-error" class="error-banner" hidden></div>
  <table class="acct-table">
    <thead>
      <tr>
        <th data-i18n="acct.id">ID</th>
        <th data-i18n="acct.label">Label</th>
        <th data-i18n="acct.state">State</th>
        <th data-i18n="acct.expires">Token expires</th>
        <th data-i18n="acct.email">Email</th>
        <th data-i18n="acct.deviceId">Device ID</th>
        <th data-i18n="acct.enabled">Enabled</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="acct-rows"></tbody>
  </table>
  <p id="acct-empty" class="muted" data-i18n="acct.none" hidden>No accounts yet</p>
</section>`
}

/** Body of a <script> tag. Uses window.t() for anything built at runtime. */
export function accountsScript(): string {
  return `
  const acctT = (k, v) => (window.t ? window.t(k, v) : k);
  const acctStateLabel = (s) => acctT('acct.state' + s.charAt(0).toUpperCase() + s.slice(1));
  const acctEsc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function acctShowError(message) {
    const box = document.getElementById('acct-error');
    box.textContent = message;
    box.hidden = !message;
  }

  async function acctApi(url, options) {
    const res = await fetch(url, options);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function acctLoad() {
    acctShowError('');
    try {
      const { accounts } = await acctApi('/api/accounts');
      const body = document.getElementById('acct-rows');
      document.getElementById('acct-empty').hidden = accounts.length > 0;
      body.innerHTML = accounts.map((a) => \`
        <tr data-id="\${acctEsc(a.id)}">
          <td><code>\${acctEsc(a.id)}</code></td>
          <td>\${acctEsc(a.label)}</td>
          <td><span class="badge badge-\${acctEsc(a.state)}">\${acctEsc(acctStateLabel(a.state))}</span></td>
          <td>\${a.expiresAt ? new Date(a.expiresAt).toLocaleString() : '-'}</td>
          <td>\${acctEsc(a.email)}</td>
          <td><code>\${acctEsc(a.deviceId.slice(0, 8))}...</code></td>
          <td><input type="checkbox" class="acct-enabled" \${a.enabled ? 'checked' : ''} /></td>
          <td>
            <button class="acct-login">\${acctEsc(acctT('acct.relogin'))}</button>
            <button class="acct-delete danger">\${acctEsc(acctT('acct.delete'))}</button>
          </td>
        </tr>
        <tr class="acct-login-row" hidden>
          <td colspan="8">
            <p data-i18n="acct.loginStep1">Open this URL, approve, then paste the code back here</p>
            <a class="acct-login-url" target="_blank" rel="noreferrer noopener"></a>
            <input class="acct-code" data-i18n-ph="acct.loginStep2" />
            <button class="acct-complete">\${acctEsc(acctT('acct.loginSubmit'))}</button>
          </td>
        </tr>\`).join('');
      if (window.applyI18n) window.applyI18n(body);
    } catch (err) {
      acctShowError(err.message);
    }
  }

  document.getElementById('acct-add').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    try {
      await acctApi('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id.value.trim(), label: form.label.value.trim() }),
      });
      form.reset();
      acctLoad();
    } catch (err) {
      acctShowError(err.message);
    }
  });

  // One delegated listener for the whole table - rows are re-rendered wholesale.
  document.getElementById('acct-rows').addEventListener('click', async (ev) => {
    const row = ev.target.closest('tr[data-id]') || ev.target.closest('tr')?.previousElementSibling;
    if (!row) return;
    const id = row.dataset.id;
    try {
      if (ev.target.classList.contains('acct-login')) {
        const { url } = await acctApi('/api/accounts/' + encodeURIComponent(id) + '/login', { method: 'POST' });
        const panel = row.nextElementSibling;
        const link = panel.querySelector('.acct-login-url');
        link.href = url;
        link.textContent = url;
        panel.hidden = false;
        return;
      }
      if (ev.target.classList.contains('acct-complete')) {
        const panel = ev.target.closest('tr');
        const code = panel.querySelector('.acct-code').value.trim();
        await acctApi('/api/accounts/' + encodeURIComponent(id) + '/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        panel.hidden = true;
        acctLoad();
        return;
      }
      if (ev.target.classList.contains('acct-delete')) {
        await acctApi('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
        acctLoad();
      }
    } catch (err) {
      // A 409 on delete carries the list of clients still bound to the account.
      acctShowError(err.message);
    }
  });

  document.getElementById('acct-rows').addEventListener('change', async (ev) => {
    if (!ev.target.classList.contains('acct-enabled')) return;
    const id = ev.target.closest('tr[data-id]').dataset.id;
    try {
      await acctApi('/api/accounts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: ev.target.checked }),
      });
    } catch (err) {
      acctShowError(err.message);
      acctLoad();
    }
  });

  acctLoad();
`
}
```

**Không dùng `confirm()` hay `alert()`** — chúng chặn toàn bộ event loop của trang và làm hỏng phiên tự động hoá; lỗi hiện ở `#acct-error`.

- [ ] **Step 4: Thêm CSS badge**

Vào khối `<style>` của `src/dashboard.ts`, cạnh các quy tắc `.badge` sẵn có (nếu chưa có `.badge` thì đặt gần `.quota-win`, dòng ~379):

```css
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  .badge-ok { background: #123524; color: #4ade80; }
  .badge-refreshing { background: #3a2f0b; color: #facc15; }
  .badge-expired { background: #3b1219; color: #f87171; }
  .badge-uninitialized { background: var(--panel-2); color: var(--muted); }
  .error-banner { background: #3b1219; color: #f87171; padding: 10px 12px; border-radius: 8px; margin: 10px 0; }
```

- [ ] **Step 5: Chèn vào `src/dashboard.ts`**

1. `import { renderAccountsSection, accountsScript } from './dashboard-accounts.js'`
2. Thêm một mục vào `aside.sidebar nav`, theo đúng cách các mục hiện có dựng link + `icon()`, nhãn dùng `data-i18n="acct.nav"`.
3. Chèn `${renderAccountsSection()}` vào vùng nội dung và `${accountsScript()}` vào trong thẻ `<script>` đã có.

Không thêm logic account nào khác vào `dashboard.ts`.

- [ ] **Step 6: Kiểm tra bằng mắt**

Khởi động gateway, đăng nhập `/admin`, mở mục Accounts.

Expected: bảng rỗng hiện `acct.none`; thêm account chạy được; bấm Re-login hiện URL authorize mở được; bật/tắt checkbox không báo lỗi; xoá account đang có binding hiện thông báo 409 ở banner chứ không phải hộp thoại. Đổi `?lang=vi` và `?lang=zh` thì mọi nhãn mới đều dịch, không còn khoá thô kiểu `acct.nav`.

- [ ] **Step 7: Kiểm tra kiểu và test**

Run: `npx tsc --noEmit && npm test`
Expected: sạch, mọi suite PASS

- [ ] **Step 8: Commit**

```bash
git add src/dashboard-accounts.ts src/dashboard.ts src/i18n.ts
git commit -m "feat(dashboard): accounts section with per-account login"
```

---

### Task 14: Gán account trong mục Clients và quota trên portal

**Files:**
- Modify: `src/dashboard.ts` (phần Clients)
- Modify: `src/portal.ts`
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: `GET`/`PUT /api/clients/:name/accounts` (Task 12), `GET /api/accounts` (Task 11)
- Produces: không có export mới

- [ ] **Step 1: Thêm khoá i18n (đủ ba ngôn ngữ)**

```ts
  // ── admin client-account bindings ──
  'bind.title': { en: 'Accounts for this client', vi: 'Tài khoản của client này', zh: '该客户端的账户' },
  'bind.add': { en: 'Add account', vi: 'Thêm tài khoản', zh: '添加账户' },
  'bind.priority': { en: 'Priority', vi: 'Ưu tiên', zh: '优先级' },
  'bind.limit': { en: 'Limit (USD)', vi: 'Hạn mức (USD)', zh: '限额 (USD)' },
  'bind.period': { en: 'Period', vi: 'Chu kỳ', zh: '周期' },
  'bind.unlimited': { en: '0 = unlimited', vi: '0 = không giới hạn', zh: '0 = 不限' },
  'bind.save': { en: 'Save bindings', vi: 'Lưu gán', zh: '保存绑定' },
  'bind.none': {
    en: 'No accounts assigned - this client gets 503',
    vi: 'Chưa gán tài khoản - client này sẽ nhận 503',
    zh: '未分配账户 - 该客户端将收到 503',
  },
  'bind.order': {
    en: 'Lower priority is used first',
    vi: 'Ưu tiên nhỏ hơn được dùng trước',
    zh: '优先级数字越小越先使用',
  },
  'bind.periodLifetime': { en: 'Lifetime', vi: 'Trọn đời', zh: '累计' },
  'bind.periodMonthly': { en: 'Monthly', vi: 'Hàng tháng', zh: '每月' },
  'bind.periodDaily': { en: 'Daily', vi: 'Hàng ngày', zh: '每天' },
  'portal.quotaPerAccount': {
    en: 'Quota per account', vi: 'Hạn mức theo tài khoản', zh: '各账户限额',
  },
  'portal.used': { en: 'Used', vi: 'Đã dùng', zh: '已用' },
  'admin.acctColumn': { en: 'Account', vi: 'Tài khoản', zh: '账户' },
  'admin.acctFilterAll': { en: 'All accounts', vi: 'Tất cả tài khoản', zh: '全部账户' },
```

(`portal.quotaPerAccount` đã thêm ở Task 10 — bỏ qua nếu đã có.)

- [ ] **Step 2: UI gán account**

Trong phần Clients của `src/dashboard.ts`, mỗi client có một khối gán: danh sách các hàng `{account (select), priority (number), limit_usd (number), limit_period (select)}`, nút thêm hàng, nút xoá hàng, nút Save. `<select>` chu kỳ dùng ba khoá `bind.periodLifetime|Monthly|Daily`.

Save gom cả mảng rồi `PUT /api/clients/:name/accounts` một lần — khớp với ngữ nghĩa "thay cả mảng" của endpoint. Danh sách account trong `<select>` lấy từ `GET /api/accounts`.

Hiện `bind.none` khi mảng rỗng, và `bind.order` làm chú thích dưới cột Priority.

- [ ] **Step 3: Cột Account trong bảng metrics**

Thêm cột Account vào bảng request gần đây và một `<select>` lọc theo account. Nguồn dữ liệu: cột `account_id` đã có từ Task 6 — thêm nó vào các truy vấn `getClientRecent`/`getMetricsSnapshot` trong `src/metrics.ts` nếu chưa được chọn ra.

- [ ] **Step 4: Portal hiện quota theo account**

Hoàn thiện phần đã dựng ở Task 10 Step 4: render `quotas` thành bảng nhỏ với `portal.quotaPerAccount` làm tiêu đề, mỗi hàng là `account · used / limit · period`. Hạn mức `0` hiện `bind.unlimited`.

- [ ] **Step 5: Kiểm tra bằng mắt**

Tạo hai account và một client, gán cả hai với priority 1 và 2, đặt hạn mức, Save, tải lại trang.

Expected: binding hiện đúng sau khi tải lại; đăng nhập portal bằng token của client đó thấy đủ hai dòng hạn mức.

- [ ] **Step 6: Kiểm tra kiểu và test**

Run: `npx tsc --noEmit && npm test`
Expected: sạch, mọi suite PASS

- [ ] **Step 7: Commit**

```bash
git add src/dashboard.ts src/portal.ts src/metrics.ts src/i18n.ts
git commit -m "feat(dashboard): assign accounts to clients, per-account quota in portal"
```

---

### Task 15: Khởi động docker-only

**Files:**
- Modify: `src/bootstrap-config.ts:128-165` (`bootstrapConfigIfMissing`), thêm `seedAccountFromEnvIfEmpty`
- Modify: `src/index.ts` (thứ tự khởi động, setup code)
- Modify: `src/proxy.ts` (`/admin` nhận setup code)
- Modify: `src/i18n.ts`, `docker-compose.yml`, `README.md`, `README.vi.md`

**Interfaces:**
- Consumes: `gatherSeedCredentials()` (đã có, giữ private), `insertAccountRow` (Task 2), `migrateFromConfig` (Task 3), `initAccounts` (Task 5), `getOrCreateMeta` (đã có trong `src/db.ts`)
- Produces:
  ```ts
  // src/bootstrap-config.ts
  export function seedAccountFromEnvIfEmpty(config: Config): boolean
  // src/users.ts
  export function consumeSetupCode(code: string): boolean
  export function currentSetupCode(): string | null
  ```

- [ ] **Step 1: Bỏ `exit(1)` khi thiếu credentials**

Trong `bootstrapConfigIfMissing`, thay khối `if (!creds || !creds.refreshToken) { ...; return false }` bằng:

```ts
  // No credentials is no longer fatal. The gateway boots empty and the admin
  // adds the first account from the dashboard — that is the whole point of the
  // docker-only setup path.
  const creds = gatherSeedCredentials()
  if (!creds) {
    log('info', 'No seed credentials found — starting with an empty account list.')
    log('info', '  Add the first account from the admin dashboard once it is up.')
  }
```

Và cho `buildConfigYaml` nhận `creds` có thể `null`, bỏ hẳn phần `oauth:` khỏi YAML sinh ra khi không có credentials. Hàm luôn `return true`.

- [ ] **Step 2: Thêm `seedAccountFromEnvIfEmpty`**

```ts
/**
 * Create the first account from CCG_REFRESH_TOKEN or a mounted credentials.json.
 *
 * Optional convenience, kept because README.vi.md documents it: it saves a
 * browser login on a fresh server. Skipped entirely when accounts already
 * exist — including right after the config.yaml migration has run.
 */
export function seedAccountFromEnvIfEmpty(config: Config): boolean {
  const existing = getDb().prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }
  if (existing.n > 0) return false

  const creds = gatherSeedCredentials()
  if (!creds?.refreshToken) return false

  insertAccountRow({
    id: 'default',
    label: 'Seeded',
    refreshToken: creds.refreshToken,
    accessToken: creds.accessToken || '',
    expiresAt: creds.expiresAt || 0,
    deviceId: config.identity?.device_id,
    email: config.identity?.email || '',
  })
  log('info', 'Seeded account "default" from environment credentials')
  return true
}
```

- [ ] **Step 3: Setup code cho admin đầu tiên**

Trong `src/users.ts`:

```ts
import { randomBytes } from 'crypto'
import { getDb, getOrCreateMeta } from './db.js'

const SETUP_CODE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * A one-time code that lets the very first admin account be created through the
 * browser. Without it, a gateway with no users would have no way in — and the
 * docker-only setup path has no shell to run add-user from.
 */
export function currentSetupCode(): string | null {
  if (countUsers() > 0) return null
  const stored = getOrCreateMeta('setup_code', () =>
    `${randomBytes(16).toString('hex')}:${Date.now() + SETUP_CODE_TTL_MS}`,
  )
  const [code, expiresAt] = stored.split(':')
  if (Number(expiresAt) <= Date.now()) {
    const fresh = `${randomBytes(16).toString('hex')}:${Date.now() + SETUP_CODE_TTL_MS}`
    getDb().prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('setup_code', ?)`).run(fresh)
    return fresh.split(':')[0]
  }
  return code
}

export function consumeSetupCode(code: string): boolean {
  const expected = currentSetupCode()
  if (!expected || !code || code !== expected) return false
  getDb().prepare(`DELETE FROM meta WHERE key = 'setup_code'`).run()
  return true
}
```

Trong `src/proxy.ts`, ở nhánh `pathname === '/admin'`: khi `countUsers() === 0`, `GET` render form tạo admin (username, password, setup code) thay cho form đăng nhập; `POST` gọi `consumeSetupCode(code)` rồi `createUser(username, password)` và cấp session ngay.

Khoá i18n mới, đủ ba ngôn ngữ:

```ts
  // ── first-time setup ──
  'setup.title': { en: 'First-time setup', vi: 'Cài đặt lần đầu', zh: '首次设置' },
  'setup.code': {
    en: 'Setup code (see server logs)',
    vi: 'Mã cài đặt (xem log server)',
    zh: '设置码（见服务器日志）',
  },
  'setup.submit': { en: 'Create admin', vi: 'Tạo admin', zh: '创建管理员' },
  'setup.badCode': { en: 'Wrong setup code', vi: 'Mã cài đặt không đúng', zh: '设置码不正确' },
```

- [ ] **Step 3c: Làm `migrateFromConfig` chịu được config.yaml trùng tên client**

> **Bổ sung của controller (ruling, 2026-09-21).** Review Task 3 phát hiện: nếu
> `auth.tokens` cũ có hai entry trùng `name` (hoặc trùng `token`), `insertClientRow`
> đụng ràng buộc PRIMARY KEY / UNIQUE và ném lỗi. Transaction rollback nên **không**
> để lại DB nửa vời — tốt. Nhưng bước tiếp theo mới là vấn đề: lời gọi nằm trong khối
> `try` của `src/index.ts`, mà khối đó kết thúc bằng `process.exit(1)`. Bảng `accounts`
> vẫn rỗng nên lần khởi động sau migration lại chạy lại, lại ném, lại thoát —
> **container crash-loop, và admin không vào nổi dashboard để sửa.**
>
> Đó đúng là kịch bản hỏng mà cả dự án này sinh ra để diệt, nên không được để nguyên.

Trong `src/migrate-accounts.ts`, bỏ qua entry trùng thay vì ném:

```ts
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
```

Thêm test vào `tests/migration.test.ts`:

```ts
test('config trùng tên client thì bỏ qua bản sau, không ném', () => {
  const dir3 = mkdtempSync(join(tmpdir(), 'ccg-test-'))
  initDb(join(dir3, 'dup.db'))
  const dupConfig = {
    oauth: { refresh_token: 'ref-dup' },
    auth: {
      tokens: [
        { name: 'alice', token: 'tok-1' },
        { name: 'alice', token: 'tok-2' },
      ],
    },
    identity: { device_id: 'ef'.repeat(32), email: 'dup@example.com' },
  } as unknown as Config
  assert.doesNotThrow(() => migrateFromConfig(dupConfig))
  assert.equal(listClientRows().length, 1)
  assert.equal(listAccountRows().length, 1)
  rmSync(dir3, { recursive: true, force: true })
})
```

- [ ] **Step 4: Nối thứ tự khởi động trong `src/index.ts`**

```ts
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
  await initAccounts()

  const setupCode = currentSetupCode()
  if (setupCode) {
    log('warn', '─────────────────────────────────────────────')
    log('warn', `First-time setup code: ${setupCode}`)
    log('warn', `  Open https://<your-domain>/admin and use it to create the admin account.`)
    log('warn', '─────────────────────────────────────────────')
  }

  startProxy(config)
```

- [ ] **Step 5: Sửa `docker-compose.yml`**

Chuyển mount credentials thành comment:

```yaml
    volumes:
      # ccg_data persists the SQLite DB (accounts, clients, bindings, metrics)
      # and the generated config.yaml.
      - ccg_data:/app/data
      # OPTIONAL: seed the first account from a host login instead of doing the
      # browser login. Leave this commented out for a pure docker setup — the
      # gateway boots with zero accounts and you add the first one from the
      # dashboard.
      # - /root/.claude/.credentials.json:/app/data/claude-credentials.json:ro
```

- [ ] **Step 6: Khói thử đường docker-only**

```bash
rm -rf /tmp/ccg-fresh && mkdir -p /tmp/ccg-fresh
env -u CCG_REFRESH_TOKEN npx tsx src/index.ts /tmp/ccg-fresh/config.yaml
```

Expected: gateway **khởi động thành công** (không `exit(1)`), log cảnh báo không có account, và in một setup code. Mở `/admin` thấy form tạo admin; nhập sai code bị từ chối, nhập đúng thì vào thẳng `/dashboard`. Gọi `curl localhost:8443/v1/messages` trả 503 chứ không phải treo.

- [ ] **Step 7: Cập nhật README**

Trong cả `README.md` và `README.vi.md`: thay phần hướng dẫn "trích token trên máy local rồi mount" bằng luồng mới (`docker compose up` → setup code trong log → tạo admin → thêm account trên web), và ghi rõ `CCG_REFRESH_TOKEN` giờ là tuỳ chọn. Bổ sung một mục ngắn về nhiều account và gán client.

- [ ] **Step 8: Kiểm tra lần cuối**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: mọi suite PASS, không lỗi kiểu, build ra `dist/` thành công

- [ ] **Step 9: Commit**

```bash
git add src/bootstrap-config.ts src/index.ts src/users.ts src/proxy.ts src/i18n.ts docker-compose.yml README.md README.vi.md
git commit -m "feat(setup): boot with zero accounts, first-time setup code, docker-only path"
```

---

## Kiểm tra sau khi xong toàn bộ

- [ ] `npm test` xanh, `npx tsc --noEmit` sạch, `npm run build` chạy được
- [ ] `grep -rn "from './oauth.js'" src/` không ra kết quả
- [ ] `grep -rn "cost_limit_usd\|cost_limit_period" src/` chỉ còn trong `src/migrate-accounts.ts` và type `TokenEntry` của `src/config.ts`
- [ ] `grep -rn "initOAuth\|getOAuthStatus\|setOnTokensUpdated\|updateConfigOAuth" src/` không ra kết quả
- [ ] Nâng cấp thử trên bản sao DB thật: copy `ccg.db` của production ra chỗ khác, chạy gateway trỏ vào đó cùng `config.yaml` cũ, xác nhận có đúng một account `default`, đủ client, đủ binding, và một request proxy thật đi qua được
- [ ] Bản cài mới: `docker compose up` với volume trắng và không mount credentials — dựng được từ đầu tới lúc proxy chạy, hoàn toàn trên trình duyệt
