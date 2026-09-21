# Multi-account gateway — Design

Ngày: 2026-09-21
Trạng thái: đã duyệt, chờ lập kế hoạch thực thi

## 1. Vấn đề

Gateway hiện tại phục vụ đúng **một** tài khoản Claude upstream:

- `config.oauth` là một object đơn (`src/config.ts`), `src/oauth.ts` giữ đúng một
  bộ `cachedTokens` ở biến module.
- `config.identity.device_id` + `config.identity.email` được nhét vào mọi request
  (`src/rewriter.ts:195`, `:522`, `:551`) — một danh tính duy nhất cho toàn gateway.
- `src/auth.ts` map token → `TokenEntry{name, cost_limit_usd, cost_limit_period}`,
  không có khái niệm client thuộc về tài khoản nào.
- Quota là một con số phẳng cho mỗi client (`src/proxy.ts:172`).

Hệ quả:

1. Muốn phục vụ nhiều tài khoản Claude thì phải chạy nhiều container, mỗi cái một
   domain, một volume, một dashboard — thống kê không gộp được.
2. Không chia được hạn mức của một client ra theo từng tài khoản.
3. Việc đăng nhập ban đầu buộc phải làm trên máy có `claude` CLI rồi mount
   `/root/.claude/.credentials.json` vào container (`docker-compose.yml`), vì
   `src/bootstrap-config.ts:138` `exit(1)` khi không tìm thấy credentials và
   `src/config.ts` `throw` khi thiếu `oauth.refresh_token`.

## 2. Mục tiêu

- Một container, một dashboard, **N tài khoản Claude** bên trong.
- Mỗi tài khoản mang **danh tính riêng** (device_id, email, env fingerprint), để
  upstream nhìn thấy N máy độc lập chứ không phải một máy dùng N tài khoản.
- Một client **gắn được nhiều tài khoản**, mỗi cặp (client, account) có hạn mức
  riêng; dùng theo thứ tự ưu tiên, hết hạn mức thì tràn xuống tài khoản kế tiếp.
- Cài đặt **hoàn toàn trong Docker**: `docker compose up` trên một server trắng,
  mọi thao tác còn lại làm trên web. Không cần đăng nhập ở máy local, không mount
  credentials từ host.

## 3. Ngoài phạm vi

- **Không** tự động failover khi upstream trả 429/401. Chỉ "hết hạn mức thì tràn".
  Tài khoản chết bị loại khỏi vòng chọn ở request *kế tiếp*; request đang chạy trả
  lỗi thật về cho client.
- **Không** có hạn mức ở cấp tài khoản (tổng chi tiêu của cả account). Hạn mức chỉ
  tồn tại ở cặp (client, account).
- **Không** chia sẻ tài khoản giữa nhiều container. Một DB, một tiến trình.
- **Không** đụng tới `src/rewriter.ts` phần masking đường dẫn, `src/pricing.ts`,
  `src/preview.ts`, `src/usage-parser.ts`, hay trình cài đặt client trong
  `src/clients.ts` (`buildLauncherScript` và họ hàng).

## 4. Mô hình dữ liệu

Toàn bộ trạng thái động chuyển vào SQLite. `config.yaml` chỉ còn hạ tầng tĩnh.

### 4.1 Bảng mới

```sql
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,           -- slug admin đặt: "pro-1", "max-cty"
  label           TEXT    NOT NULL DEFAULT '',
  refresh_token   TEXT    NOT NULL DEFAULT '',
  access_token    TEXT    NOT NULL DEFAULT '',
  expires_at      INTEGER NOT NULL DEFAULT 0,
  state           TEXT    NOT NULL DEFAULT 'uninitialized',
  last_error      TEXT    NOT NULL DEFAULT '',
  last_refresh_at INTEGER NOT NULL DEFAULT 0,
  device_id       TEXT    NOT NULL,           -- 64 hex
  email           TEXT    NOT NULL DEFAULT '',
  env_json        TEXT    NOT NULL DEFAULT '', -- '' = kế thừa config.env
  prompt_env_json TEXT    NOT NULL DEFAULT '', -- '' = kế thừa config.prompt_env
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE TABLE clients (
  name       TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  home_dir   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE client_accounts (
  client_name  TEXT    NOT NULL REFERENCES clients(name) ON DELETE CASCADE,
  account_id   TEXT    NOT NULL REFERENCES accounts(id)  ON DELETE CASCADE,
  priority     INTEGER NOT NULL DEFAULT 0,        -- nhỏ hơn = ưu tiên trước
  limit_usd    REAL    NOT NULL DEFAULT 0,        -- 0 = không giới hạn
  limit_period TEXT    NOT NULL DEFAULT 'lifetime', -- lifetime|monthly|daily
  PRIMARY KEY (client_name, account_id)
);

CREATE INDEX idx_ca_client_priority ON client_accounts(client_name, priority);
```

`accounts.state` nhận đúng bốn giá trị của `OAuthState` hiện có:
`uninitialized | ok | refreshing | expired`.

### 4.2 Bảng sửa

```sql
ALTER TABLE request_metrics ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_rm_client_acct_ts ON request_metrics(client, account_id, ts);
```

Cột mặc định `''` giữ cho các bản ghi lịch sử đọc được; migration ở §7 sẽ gán
chúng về account `default`.

### 4.3 config.yaml sau thay đổi

Giữ lại: `server`, `upstream`, `process`, `logging`, `db`.

`identity`, `env`, `prompt_env` **đổi vai**: không còn là danh tính đang dùng, mà
là **giá trị mặc định** để điền vào account mới tạo.

`oauth` và `auth.tokens` trở thành **tuỳ chọn** trong type `Config`: runtime không
còn đọc chúng, chỉ migration (§7.2) đọc một lần. Chúng ở lại `config.yaml` như bản
lưu, không bị xoá đi.

`src/config.ts` bỏ hai chỗ `throw`: thiếu `oauth.refresh_token` và `auth.tokens`
rỗng. `identity.device_id` không còn bắt buộc là hex thật, vì nó chỉ là mẫu.

## 5. Tách `oauth.ts`

`src/oauth.ts` hiện là singleton hoàn toàn — `cachedTokens`, `state`, `lastError`,
`lastRefreshAt`, `refreshTokenExpiresAt`, `refreshTimer`, `failureCount`,
`lastMissingTokenLog`, `pendingLogin` đều là biến module. Không thể có N bản.

Tách làm hai file:

### 5.1 `src/oauth-client.ts` — thuần hàm, không state

Chuyển nguyên xi phần HTTP hiện có, chỉ bỏ biến global:

```ts
export function refreshOAuthToken(refreshToken: string): Promise<OAuthTokens>
export function beginOAuthLogin(): { url: string; verifier: string; state: string; expiresAt: number }
export function completeOAuthLogin(pasted: string, pending: PendingLogin): Promise<OAuthTokens>
export function parsePastedCode(input: string): { code: string; state: string | null }
```

`beginOAuthLogin` trả về `verifier`/`state` cho caller giữ, thay vì ghi vào biến
`pendingLogin` của module. `postToken`, `describeFailure`, `isPermanent`,
`tokensFromResponse` giữ nguyên, thành hàm nội bộ của file này.

### 5.2 `src/accounts.ts` — runtime N tài khoản

```ts
type AccountRuntime = {
  id: string
  tokens: OAuthTokens | null
  state: OAuthState
  lastError: string | null
  lastRefreshAt: number | null
  refreshTimer: NodeJS.Timeout | null
  failureCount: number
}

export async function initAccounts(defaults: IdentityDefaults): Promise<void>
export function listAccounts(): AccountView[]
export function getAccount(id: string): AccountView | null
export function createAccount(input: NewAccount): AccountView
export function updateAccount(id: string, patch: AccountPatch): AccountView
export function deleteAccount(id: string): void        // throw nếu còn binding
export function getAccessTokenFor(id: string): string | null
export function beginLogin(id: string): { url: string; expires_in_ms: number }
export function completeLogin(id: string, pasted: string): Promise<{ expires_at: number }>
export function cancelLogin(id: string): void
```

- Một `Map<string, AccountRuntime>` + một `Map<string, PendingLogin>`.
- Mỗi account có timer refresh **độc lập**; lịch refresh giữ nguyên công thức hiện
  có (`max(msUntilExpiry - 5 phút, 10s)`).
- Refresh thành công → ghi `access_token`/`expires_at`/`refresh_token` xuống
  `accounts`, thay cho `setOnTokensUpdated` → `updateConfigOAuth` hiện nay.
- `createAccount` sinh `device_id` 64 hex ngẫu nhiên nếu không được cung cấp.
- `initAccounts` nạp mọi account `enabled=1`; một account có refresh_token chết
  chuyển sang `state='expired'` và **không** làm hỏng những account còn lại.

`src/oauth.ts` bị xoá. `setOnTokensUpdated` và `updateConfigOAuth` trong
`src/bootstrap-config.ts` bị xoá theo.

## 6. Luồng một request

Trong `src/proxy.ts`, thay đoạn xác thực + kiểm tra hạn mức hiện tại:

```
1. token từ header  → clients.token → clientName          (401 nếu không khớp)
2. nạp binding:  SELECT * FROM client_accounts
                 WHERE client_name = ? ORDER BY priority ASC
3. nếu rỗng                                → 503 "client chưa gắn tài khoản nào"
4. duyệt binding theo thứ tự, chọn cái đầu tiên thoả:
     - accounts.enabled = 1
     - runtime.state ∈ {ok, refreshing} và có access_token còn hạn
     - limit_usd = 0, HOẶC
       costOf(client, account, periodStart(limit_period)) < limit_usd
5. không chọn được:
     - có ít nhất một binding bị chặn vì hạn mức  → 429, body liệt kê
       từng account kèm used/limit/period
     - còn lại (mọi account expired/disabled)     → 503
6. rewrite request bằng identity của account đã chọn
7. forward với access_token của account đã chọn
8. recordRequest({ ..., account_id })
```

Chọn account xảy ra **trước** bước rewrite, vì rewrite giờ phụ thuộc vào
`device_id`/`email`/`env` của account.

Bước 4 chỉ gác các đường dẫn tính tiền (`/v1/messages`), đúng như logic hiện tại
ở `src/proxy.ts:172`. Các đường dẫn miễn phí chọn account đầu tiên đang sống.

`src/metrics.ts`:

```ts
// mở rộng từ getClientCostSince(client, sinceTs)
export function getClientAccountCostSince(client: string, accountId: string, sinceTs: number): number
```

Một câu `SUM(cost_usd)` chạy trên `idx_rm_client_acct_ts`. `getClientCostSince`
giữ nguyên cho các màn hình tổng hợp.

`src/auth.ts` đổi nguồn: `tokenMap` nạp từ bảng `clients` thay vì
`config.auth.tokens`, và được nạp lại ngay sau mỗi thao tác CRUD client thay vì
chờ `watchFile`.

## 7. Bootstrap và migration

### 7.1 Server trắng, không credentials

1. `src/bootstrap-config.ts` sinh `config.yaml` tối thiểu khi thiếu; **bỏ** nhánh
   `exit(1)` ở dòng 138 — không có credentials thì vẫn boot. `CCG_REFRESH_TOKEN`
   và `claude-credentials.json` **giữ lại** như đường mồi tuỳ chọn (đang được
   `README.vi.md:198` mô tả): nếu có, chúng tạo sẵn account `default` để khỏi phải
   login trên web; nếu không, bỏ qua trong im lặng.
2. `src/config.ts` bỏ `throw` như §4.3.
3. `src/index.ts`: `countUsers() === 0` → sinh một **setup code** dùng-một-lần
   (32 hex, lưu ở bảng `meta`, hết hạn sau 24 giờ) và in ra log. `/admin` nhận
   code này để tạo tài khoản admin đầu tiên; tạo xong thì code bị xoá.
4. Admin vào dashboard → tab Accounts → "Thêm tài khoản" → PKCE paste code →
   account đầu tiên nằm trong DB.
5. `docker-compose.yml` chuyển mount `/root/.claude/.credentials.json` thành dòng
   comment kèm giải thích — không còn bắt buộc, vì thiếu nó container vẫn boot.

Trong suốt giai đoạn này gateway **vẫn chạy**: `/v1/*` trả 503, dashboard bình thường.

**Thứ tự chạy khi khởi động**, để hai đường tạo account `default` không giẫm chân nhau:

```
initDb() → migrate()            ← §7.2, mồi từ config.yaml nếu accounts rỗng
         → seedFromEnvIfEmpty() ← §7.1 mục 1, mồi từ env/credentials nếu vẫn rỗng
         → initAccounts()
```

Cả hai bước mồi đều điều kiện trên "bảng `accounts` rỗng", nên tối đa một cái chạy.

### 7.2 Cài đặt đang chạy

Migration một chiều, chạy một lần trong `migrate()` của `src/db.ts`, bọc trong một
transaction. Điều kiện kích hoạt: bảng `accounts` rỗng **và** `config.yaml` có
`oauth.refresh_token`.

1. Tạo account `id='default'`, `label='Migrated'`, lấy `refresh_token`,
   `access_token`, `expires_at` từ `config.oauth`; `device_id`/`email` từ
   `config.identity`; `env_json`/`prompt_env_json` để rỗng (kế thừa config).
2. Mỗi entry `config.auth.tokens` → một row `clients` (`name`, `token`,
   `home_dir`).
3. Mỗi client → một row `client_accounts` trỏ tới `default`, `priority=0`,
   `limit_usd` = `cost_limit_usd ?? 0`, `limit_period` = `cost_limit_period ??
   'lifetime'`.
4. `UPDATE request_metrics SET account_id='default' WHERE account_id=''`.
5. Ghi `meta.migrated_multi_account = '1'`.

Sau migration, hành vi quan sát được từ phía client **giống hệt** trước đó.

`config.yaml` không bị sửa — các khoá `oauth`/`auth` ở lại đó như bản lưu, không
còn được đọc. `watchFile` hot-reload `auth.tokens` trong `src/index.ts:80` bị gỡ;
phần đồng bộ `env.version` giữ nguyên.

## 8. API và dashboard

### 8.1 Endpoint mới

```
GET    /api/accounts                   danh sách + state + usage tổng
POST   /api/accounts                   tạo (sinh device_id nếu thiếu)
PATCH  /api/accounts/:id               label, email, env, prompt_env, enabled
DELETE /api/accounts/:id               409 nếu còn binding
POST   /api/accounts/:id/login         → { url, expires_in_ms }
POST   /api/accounts/:id/complete      { code } → { expires_at }
POST   /api/accounts/:id/cancel        huỷ login đang chờ

GET    /api/clients/:name/accounts     binding hiện tại
PUT    /api/clients/:name/accounts     set cả mảng
                                       [{ account_id, priority, limit_usd, limit_period }]
```

Tất cả nằm sau phiên admin, thêm vào `handleDashboardArea` trong `src/proxy.ts`
cạnh khối `/api/oauth` hiện có. Khối `/api/oauth` cũ bị thay bằng
`/api/accounts/:id/...`.

`PUT /api/clients/:name/accounts` thay cả mảng trong một transaction — đơn giản
hơn CRUD từng binding, và tránh trạng thái nửa vời khi UI gửi nhiều lệnh.

### 8.2 Dashboard

- Tab **Accounts** mới: bảng account với state badge, hạn access token, nút "Đăng
  nhập lại", nút bật/tắt, form sửa identity.
- Tab Clients: thêm ô gán account — chọn nhiều account, kéo thứ tự ưu tiên, nhập
  hạn mức từng cặp.
- Bảng metrics thêm cột Account; bộ lọc theo account.
- `src/i18n.ts`: thêm khoá cho toàn bộ chuỗi mới (cả `en` và `vi`).

### 8.3 Portal client

`src/portal.ts` — `/portal/me` hiển thị hạn mức còn lại **theo từng account** của
client đó, thay cho một con số phẳng.

## 9. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Account có refresh_token chết | `state='expired'`, bị bỏ qua khi routing, badge đỏ + nút đăng nhập lại trên dashboard |
| Client hết hạn mức trên mọi account | 429, body liệt kê từng account với used/limit/period |
| Client không gắn account nào | 503, thông báo rõ |
| Không account nào sống | `/v1/*` trả 503, dashboard vẫn chạy |
| Xoá account còn binding | 409, liệt kê các client đang dùng |
| Trùng `account.id` | 409 |
| Refresh lỗi tạm thời | Lùi dần theo `failureCount` như hiện tại, giữ nguyên trên từng account |

Một account hỏng không được phép ảnh hưởng account khác. Đây là bất biến chính của
`src/accounts.ts`.

## 10. Test

Nối vào `npm test` hiện có (chạy `tsx` trực tiếp, không framework, khẳng định bằng
`assert`). DB dùng `:memory:`.

- `tests/routing.test.ts`
  - chọn account theo `priority` tăng dần
  - bỏ qua account đã cạn hạn mức, dùng cái kế tiếp
  - bỏ qua account `expired` và `enabled=0`
  - cạn mọi account → 429 với body liệt kê đủ
  - không có binding → 503
  - đường dẫn miễn phí không bị hạn mức chặn
- `tests/accounts.test.ts`
  - hai account refresh độc lập, mỗi cái một timer
  - một account `expired` không làm hỏng account còn lại
  - `createAccount` sinh device_id 64 hex duy nhất
  - `deleteAccount` bị chặn khi còn binding
- `tests/migration.test.ts`
  - config.yaml một-tài-khoản → DB: 1 account, N client, N binding
  - `cost_limit_usd`/`cost_limit_period` chuyển đúng sang binding
  - `request_metrics` cũ được gán `account_id='default'`
  - chạy `migrate()` hai lần không nhân đôi dữ liệu
- `tests/rewriter.test.ts` (bổ sung vào file sẵn có)
  - rewrite dùng `device_id`/`email` của account được chọn
  - `env_json` rỗng → kế thừa `config.env`; có giá trị → ghi đè

## 11. Thứ tự thực thi đề xuất

1. Schema + migration (§4, §7.2) — có test trước khi đụng runtime.
2. Tách `oauth-client.ts` khỏi `oauth.ts`, giữ nguyên hành vi một-tài-khoản.
3. `accounts.ts` + `initAccounts` thay `initOAuth`.
4. Routing + hạn mức theo cặp trong `proxy.ts`, `metrics.ts`, `auth.ts`.
5. Rewrite theo identity của account.
6. API `/api/accounts` + `/api/clients/:name/accounts`.
7. Dashboard UI + i18n + portal.
8. Bootstrap docker-only (§7.1) + `docker-compose.yml`.

Mỗi bước giữ cho `npm test` xanh và gateway khởi động được.

## 12. Rủi ro

- **`proxy.ts` đã 1394 dòng.** Thêm routing vào đó sẽ làm nó phình. Đưa việc chọn
  account ra một hàm thuần trong `accounts.ts` (`selectAccountFor(clientName)`),
  `proxy.ts` chỉ gọi và xử lý kết quả.
- **`dashboard.ts` đã 2138 dòng.** Tab Accounts nên nằm ở file riêng
  (`dashboard-accounts.ts`) thay vì nối thêm.
- **Migration chạy một lần, không có đường lùi.** Bước 1 của §11 phải có test
  trước khi bất kỳ runtime nào đọc bảng mới. Khuyến nghị backup `ccg.db` trước
  khi deploy bản có migration.
