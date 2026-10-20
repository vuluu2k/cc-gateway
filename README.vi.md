# CC Gateway — Hướng dẫn Deploy & Sử dụng Local

Tài liệu tiếng Việt mô tả cách triển khai CC Gateway và cách dùng ở môi trường local. Bản tiếng Anh đầy đủ ở [`README.md`](README.md).

CC Gateway là một reverse proxy đứng giữa Claude Code và Anthropic API, làm nhiệm vụ chuẩn hoá identity (device ID, email, env, headers, prompt, billing header…) để nhiều máy dùng chung một hoặc nhiều account Claude, mỗi account "lộ" ra đúng một danh tính riêng.

---

## Cách hoạt động

Người dùng vẫn chạy Claude Code như cũ. Gateway đứng giữa: chọn một account Claude còn dùng được, đổi danh tính của request cho khớp account đó, rồi gửi lên Anthropic bằng token OAuth của account đó. Bản trực quan (sơ đồ tuyến, phần thử chọn account, vòng đời account) ở [`docs/how-it-works.html`](docs/how-it-works.html), mở bằng trình duyệt.

```mermaid
flowchart LR
  A[alice] & B[bob] & C[... các client khác] -->|token client| N[nginx / TLS]
  N --> G{{cc-gateway}}
  G -->|danh tính + token pro-1| U[api.anthropic.com]
  G -->|danh tính + token pro-2| U
  G -->|pro-3 qua proxy_url riêng| P[HTTP proxy] --> U
```

### Một request đi qua những bước nào

| # | Bước | Có thể dừng với |
|---|------|-----------------|
| 1 | **Nhận diện client** bằng token (bảng `clients`). | `401` token không tồn tại |
| 2 | **Lấy các account đã gán** cho client (`client_accounts`): mỗi cặp có ưu tiên (số nhỏ dùng trước) và hạn mức riêng. | `503` client chưa được gán account |
| 3 | **Chọn account**: đi theo ưu tiên, lấy account đầu tiên đang bật, còn token hợp lệ, và client chưa tiêu hết hạn mức trên account đó trong kỳ (trọn đời / tháng / ngày, theo UTC). Hạn mức `0` = không giới hạn. Chỉ request tính tiền `/v1/messages` mới bị hạn mức chặn. | `429` mọi account dùng được đều hết hạn mức (body liệt kê đã dùng/hạn mức); `503` mọi account đều tắt hoặc cần đăng nhập lại |
| 4 | **Đổi danh tính** sang account đã chọn: `device_id`, email, fingerprint env, prompt env; che đường dẫn máy client. | |
| 5 | **Gửi lên Anthropic** bằng access token của account, qua `proxy_url` của account nếu có (không có thì dùng `HTTPS_PROXY` chung, không có nữa thì đi thẳng). | |
| 6 | **Trả kết quả**, đổi đường dẫn về lại như cũ, **ghi chi phí** theo cặp (client, account), cập nhật quota 5h/tuần của account. | |

Gateway **không tự chuyển account** khi Anthropic trả 429/401 giữa chừng: request đó trả lỗi thật, account hỏng bị bỏ qua từ request kế tiếp.

### Vòng đời account

Mỗi account tự giữ token và timer làm mới riêng; một account hỏng không kéo account khác hỏng theo.

```mermaid
stateDiagram-v2
  [*] --> uninitialized: Thêm account (dashboard)
  uninitialized --> ok: Re-login (mở link, dán code)
  ok --> refreshing: 5 phút trước khi hết hạn
  refreshing --> ok: làm mới xong
  refreshing --> refreshing: lỗi tạm thời, thử lại 30s..10 phút
  refreshing --> expired: refresh_token bị từ chối
  expired --> ok: Re-login
```

Mỗi account sửa được nhãn, email, env / prompt env riêng và `proxy_url` tuỳ chọn (`http://user:pass@host:port`; mật khẩu không bao giờ hiện lại). Để trống `proxy_url` thì mọi account đi ra bằng IP của server.

### Dữ liệu nằm ở đâu

Toàn bộ trong `data/` (volume Docker / thư mục bind mount):

| Đường dẫn | Nội dung |
|-----------|----------|
| `ccg.db` → `accounts` | token OAuth, danh tính, proxy của từng account |
| `ccg.db` → `clients`, `client_accounts` | token client; gán account kèm ưu tiên + hạn mức |
| `ccg.db` → `request_metrics`, `users`, `meta` | chi phí từng request, tài khoản admin, trạng thái setup |
| `config.yaml` | cấu hình tĩnh + danh tính mẫu cho account mới |
| `backups/` | bản backup SQLite (deploy VPS giữ 14 bản) |

`oauth:` / `auth.tokens` trong `config.yaml` chỉ được đọc **một lần** để chuyển bản cài một-account cũ vào DB. Sau đó sửa chúng không còn tác dụng; mọi thứ quản lý trên dashboard. Deploy lên VPS: xem [`deploy/vps/README.md`](deploy/vps/README.md).

### Ai làm gì

- **Admin** (`/admin`): tạo admin đầu tiên bằng setup code in trong log; thêm account và đăng nhập ngay trên dashboard; tạo client, gán account theo thứ tự ưu tiên kèm hạn mức từng cặp; theo dõi chi phí theo client/account và quota 5h/tuần của từng account.
- **Người dùng client**: cài launcher một lần, dùng Claude Code bình thường; xem hạn mức còn lại theo từng account ở `/portal`.

---

## 1. Yêu cầu

- **Node.js 22+** (chạy trực tiếp) hoặc **Docker + Docker Compose** (chạy container).
- Đã đăng nhập Claude Code trên máy admin ít nhất một lần (để có OAuth credentials trong macOS Keychain hoặc `~/.claude/.credentials.json`).
- `python3`, `openssl`, `bash` (script setup cần đến).
- Tuỳ chọn: HTTP/HTTPS proxy (Clash, V2Ray…) nếu mạng cần.

Kiểm tra nhanh:

```bash
node -v          # >= v22
docker -v        # nếu định deploy bằng Docker
claude --version # đảm bảo đã login Claude Code
```

---

## 2. Chạy local (development)

### 2.1. Setup một câu lệnh

```bash
git clone https://github.com/motiful/cc-gateway.git
cd cc-gateway
npm install
bash scripts/quick-setup.sh
```

Script `quick-setup.sh` sẽ:

1. Đọc OAuth token (access + refresh + expires) từ Keychain hoặc `~/.claude/.credentials.json`.
2. Sinh `device_id` và `client_token` ngẫu nhiên.
3. Ghi `config.yaml` ở thư mục gốc.
4. Tạo launcher cho client đầu tiên ở `./clients/cc-<hostname>`.
5. Khởi động gateway ở `http://localhost:8443` bằng `npm run dev` (tsx watch, auto-reload).

Nếu `config.yaml` đã tồn tại, script chỉ start gateway, không ghi đè config.

### 2.2. Sử dụng

Mở terminal khác:

```bash
./clients/cc-<hostname>
```

Claude Code sẽ chạy và toàn bộ traffic đi qua gateway. Mọi tham số gốc của `claude` đều dùng được, ví dụ:

```bash
./clients/cc-<hostname> --print "hello"
./clients/cc-<hostname> --resume
```

### 2.3. Cài làm lệnh `ccg` cho tiện

```bash
chmod +x ./clients/cc-<hostname>
./clients/cc-<hostname> install   # tạo lệnh `ccg` toàn hệ thống
ccg                               # chạy Claude Code qua gateway
ccg status                        # xem trạng thái kết nối + hijack
ccg help                          # liệt kê toàn bộ subcommand
```

Tuỳ chọn "hijack" để lệnh `claude` mặc định cũng đi qua gateway:

```bash
ccg hijack    # alias claude → ccg (terminal mới tự áp dụng)
ccg release   # huỷ hijack, trả lại claude gốc
ccg native    # chạy claude gốc một lần, bỏ qua gateway
```

### 2.4. Thêm client (cho user khác trong team)

Client nằm trong database, không còn đọc từ `config.yaml`, nên thêm client bằng dashboard web (mục 4):

1. **Clients -> + Add client**: sinh token và tải về launcher `cc-<tên>` (điền địa chỉ gateway và scheme trong form; để trống thì dùng địa chỉ bạn đang mở dashboard).
2. Bấm **Tài khoản của client này** (giao diện tiếng Anh: *Accounts for this client*) ở dòng client đó để gán một hoặc nhiều account upstream (độ ưu tiên + hạn mức tuỳ chọn). Client chưa được gán account sẽ nhận `503`.

Gửi nguyên file launcher cho user — không cần share `config.yaml`, không cần OAuth login lại. Không cần restart gateway.

`scripts/add-client.sh` giờ chỉ còn ghi launcher cho một token **đã có** trong gateway (`quick-setup.sh` / `admin-setup.sh` dùng nó); gọi không kèm token thì script báo lỗi và chỉ sang dashboard.

### 2.5. Chạy sau lưng proxy

```bash
HTTPS_PROXY=http://127.0.0.1:7890 bash scripts/quick-setup.sh
# hoặc chạy thủ công:
HTTPS_PROXY=http://127.0.0.1:7890 npm run dev
```

Gateway tôn trọng `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` cho cả request lên Anthropic API lẫn refresh token.

### 2.6. Lệnh npm hữu ích

```bash
npm run dev                      # tsx watch, auto-reload
npm run build                    # biên dịch TypeScript ra dist/
npm start                        # chạy bản đã build
npm test                         # chạy test rewriter
npm run add-user -- <username>   # tạo user đăng nhập dashboard (bản đã build)
npm run add-user:dev -- <username>  # tương tự, chạy bằng tsx
npm run generate-token           # sinh token rời
npm run generate-identity        # sinh identity rời
```

> **Lưu ý:** `add-user` tạo tài khoản đăng nhập **dashboard web** (lưu trong SQLite ở `./data/ccg.db`), khác với client (launcher Claude Code, tạo trong dashboard). Xem chi tiết ở mục 4.

---

## 3. Deploy bằng Docker (production)

### 3.0. Cài đặt chỉ bằng Docker (không cần credentials)

```bash
docker compose up -d
docker compose logs gateway | grep "setup code"
```

1. Gateway khởi động với 0 account và in ra log một **mã cài đặt** dùng một lần (hạn 24h). Hết hạn thì restart container (`docker compose restart gateway`) để in mã mới.
2. Mở `https://<domain>/admin`, nhập username, mật khẩu và mã cài đặt để tạo admin đầu tiên.
3. Trong dashboard, vào **Accounts -> Add account** rồi đăng nhập Claude ngay trên trình duyệt.
4. Tạo client và gán client vào account.

`CCG_REFRESH_TOKEN` (hoặc file credentials mount vào) giờ là **tuỳ chọn**: chỉ dùng để seed account đầu tiên trên server mới, bỏ qua bước đăng nhập trình duyệt. `/_health` luôn trả 200 khi tiến trình còn chạy; tình trạng account nằm trong body (`accounts_usable`, `accounts_expired`).

**Nhiều account:** thêm bao nhiêu account Claude tuỳ ý. Mỗi client được gán vào một hoặc nhiều account kèm độ ưu tiên (số nhỏ = dùng trước) và hạn mức chi tiêu riêng từng account (`0` = không giới hạn; chu kỳ `lifetime`/`monthly`/`daily`). Hết hạn mức thì client tràn sang account kế tiếp; không có failover tự động khi gặp 401/429.

### 3.1. Setup tự động (tuỳ chọn)

Trên máy admin (đã login Claude Code):

```bash
bash scripts/admin-setup.sh
```

Script sẽ hỏi tương tác:
1. Lấy OAuth credentials.
2. Tạo `config.yaml` + launcher cho client đầu tiên.
3. Build và `docker compose up -d`.
4. Hỏi địa chỉ public mà client sẽ kết nối tới.

Sau khi container chạy, kiểm tra:

```bash
docker compose ps
docker compose logs -f gateway
curl http://localhost:8443/_health   # phải trả về 200
```

### 3.2. Thêm client sau khi đã deploy

Vào dashboard (`https://<domain>/admin`): **Accounts** để thêm account Claude (hoặc **Re-login** khi refresh token của account chết), **Clients -> + Add client** để tạo client và tải launcher, rồi gán account cho client. Không cần restart.

`docker-compose.yml` mount `ccg_data` (volume) để giữ `config.yaml` + SQLite giữa các lần restart, nên `device_id` và token sẽ không bị reset.

### 3.3. Deploy với Coolify (sẵn cấu hình)

`docker-compose.yml` đã có sẵn label cho Coolify + Traefik:
- Tạo service mới trên Coolify, point tới repo này.
- Set domain (Coolify tự sinh `SERVICE_FQDN_GATEWAY`).
- Traefik sẽ tự cấp Let's Encrypt cert và redirect HTTP → HTTPS.
- Tuỳ chọn: mount `~/.claude/.credentials.json` ở host vào `/app/data/claude-credentials.json` (read-only) để seed account đầu tiên (mặc định đã comment trong `docker-compose.yml`).

### 3.4. Deploy thủ công với TLS tự ký

Khi cần TLS mà không có domain công khai:

```bash
mkdir certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj "/CN=cc-gateway"
```

Bỏ comment phần `tls` trong `config.yaml`, sau đó tải launcher ở dashboard → **Clients -> + Add client**, điền địa chỉ `<gateway-ip>:8443` và scheme `https` trong form.

Launcher tự thêm `NODE_TLS_REJECT_UNAUTHORIZED=0` để chấp nhận self-signed cert.

### 3.5. Tailscale (lựa chọn nhẹ nhất)

Nếu mọi máy đều có Tailscale, chạy gateway trên một máy bất kỳ trong mesh — không cần TLS, không cần public IP, không cần forward port. Trỏ launcher tới hostname Tailscale (vd: `gateway.tailnet-xxx.ts.net:8443`).

### 3.6. Auto-bootstrap config khi khởi động

Khi container start lần đầu mà chưa có `config.yaml` ở `/app/data/config.yaml` (hoặc đường dẫn trong `CCG_CONFIG_PATH`), gateway sẽ tự sinh config từ một trong các nguồn sau:

- `CCG_REFRESH_TOKEN` env var (nếu set).
- File `claude-credentials.json` mount vào (mặc định `/app/data/claude-credentials.json`, read-only).

Mount này đã được comment sẵn trong `docker-compose.yml`; bỏ comment nếu muốn seed account đầu tiên từ login của host. Nếu không có nguồn nào, gateway vẫn khởi động với 0 account.

Ngoài ra:
- **Token nằm trong database**: mỗi account lưu access/refresh token trong `ccg.db`, và token rotate khi refresh được ghi vào đó — `config.yaml` không còn là trạng thái sống.
- **Seed chỉ một lần**: khối `oauth` + `auth.tokens` của `config.yaml` (hoặc credentials từ env/file mount) chỉ được nhập vào database ở lần khởi động đầu tiên của DB đó. Sau đó đổi `credentials.json` hay `config.yaml` không còn tác dụng; xoá hết account rồi restart cũng không tạo lại. Account hỏng thì **Re-login** trong dashboard → Accounts.

Có thể sinh thủ công `config.yaml` từ login Claude hiện có:

```bash
bash scripts/gen-config.sh --client whiletrue0x > config.yaml
# hoặc ghi thẳng vào file Coolify volume:
bash scripts/gen-config.sh --out /data/coolify/applications/<id>/config.yaml
```

---

## 4. Dashboard web

Gateway expose sẵn một dashboard quản trị ở chính port 8443 (`/dashboard`), không phải port riêng:

| Path | Mục đích |
|---|---|
| `/` | Trang giới thiệu |
| `/admin` | Đăng nhập admin; lần đầu (chưa có admin) là form tạo admin bằng setup code |
| `/dashboard` | Usage/cost, mục Accounts (thêm, đăng nhập lại, sửa, proxy), mục Clients (tạo client, gán account + hạn mức) |
| `/portal` | Trang của client: xem hạn mức còn lại theo từng account |
| `/api/accounts`, `/api/clients` | REST API cho dashboard (cookie session admin) |
| `/_health` | Health check (không cần login, luôn 200 khi tiến trình còn sống) |

### 4.1. Tạo user đăng nhập dashboard

Lần đầu start (chưa có admin), log in ra **setup code** dùng một lần, hết hạn sau 24 giờ:

```bash
docker compose logs gateway | grep -i 'setup code'
```

Mở `/admin`, nhập username, password và setup code để tạo admin đầu tiên. Hết hạn thì restart container để in code mới. Muốn tạo thêm admin bằng dòng lệnh vẫn dùng được script:

```bash
npm run add-user:dev -- admin                                   # local (dev)
docker compose exec gateway node dist/scripts/add-user.js admin  # trong container
```

### 4.2. Tính năng dashboard

- **Quản lý client trong UI**: thêm/xoá launcher trực tiếp, copy lệnh cài đặt cho user.
- **Per-request token usage & cost**: mỗi request lưu input / output / cache tokens riêng.
- **Tổng hợp theo period**: today / 7 ngày / 30 ngày / all time.
- **Nhiều account**: mục Accounts thêm account, đăng nhập lại, sửa label / email / env / prompt_env, xem tổng chi phí từng account; hạn mức 5h/tuần hiển thị riêng từng account.
- **Không cần restart**: client và account lưu trong SQLite, thay đổi trong dashboard có hiệu lực ngay.

Pricing tính trong `src/pricing.ts`. Dữ liệu metric lưu SQLite, sống cùng volume `ccg_data` nên không mất khi redeploy.

---

## 5. Cấu trúc file quan trọng

```
cc-gateway/
├── src/
│   ├── index.ts         # entrypoint, watchFile config hot-reload
│   ├── proxy.ts         # HTTP server, route dashboard + proxy upstream
│   ├── dashboard.ts     # HTML cho /admin + /dashboard
│   ├── rewriter.ts      # rewrite identity, env, prompt, headers
│   ├── oauth.ts         # quản lý access/refresh token
│   ├── auth.ts          # auth bằng client token (proxy) + session (dashboard)
│   ├── users.ts         # CRUD user dashboard (scrypt hash)
│   ├── clients.ts       # CRUD client launcher
│   ├── db.ts            # SQLite (better-sqlite3)
│   ├── metrics.ts       # ghi nhận request + token usage
│   ├── usage-parser.ts  # bóc tách input/output/cache token từ response
│   ├── pricing.ts       # bảng giá theo model
│   ├── bootstrap-config.ts  # auto-sinh config.yaml lần đầu
│   ├── proxy-agent.ts   # honour HTTPS_PROXY / HTTP_PROXY
│   ├── session.ts       # cookie session cho dashboard
│   ├── config.ts        # parse YAML
│   ├── logger.ts
│   └── scripts/         # add-user, generate-token, generate-identity
├── scripts/             # bash scripts dùng từ shell
│   ├── quick-setup.sh   # setup + start local trong 1 lệnh
│   ├── admin-setup.sh   # deploy Docker tương tác
│   ├── add-client.sh    # ghi launcher cho token đã có (dùng bởi các script setup)
│   ├── extract-token.sh # rút OAuth token khỏi Keychain
│   └── gen-config.sh    # sinh config.yaml từ login Claude hiện có
├── clients/             # launcher cho từng user (gitignore)
├── data/                # SQLite + config khi chạy local (gitignore)
├── config.yaml          # config gateway (gitignore, do script sinh hoặc bootstrap)
├── config.example.yaml  # mẫu để tham khảo cấu trúc
├── docker-compose.yml   # deploy Docker + Coolify + Traefik
├── Dockerfile           # multi-stage build Node 22
└── clash-rules.yaml     # rule Clash chặn traffic trực tiếp tới Anthropic
```

---

## 6. Troubleshooting

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `Error: No Claude Code credentials found` | Chưa login Claude Code lần nào. Chạy `claude` trên máy admin, hoàn tất OAuth qua trình duyệt, rồi chạy lại setup. |
| Chưa có admin, không vào được `/admin` | Lấy setup code: `docker compose logs gateway \| grep -i 'setup code'`, rồi tạo admin ở `/admin`. Code hết hạn sau 24 giờ; restart container để in code mới. |
| Gateway start xong nhưng client báo 401 | Token trong launcher không có trong database. Tải lại launcher từ dashboard → Clients (hoặc tạo client mới). Sửa `auth.tokens` trong `config.yaml` không còn tác dụng. |
| Anthropic trả 401 dù vừa refresh | Đảm bảo bản đang chạy là sau commit `497f46f` (forward OAuth qua `Authorization: Bearer` + `anthropic-beta`). Build lại nếu deploy bằng Docker. |
| Refresh token bị "consumed" sau restart | Token rotate được ghi vào `ccg.db`. Kiểm tra quyền ghi của `data/`, rồi **Re-login** account đó trong dashboard → Accounts. |
| Refresh token hết hạn (hiếm, sau vài tháng) | Dashboard → Accounts → **Re-login** cho account đó. Các account khác không bị ảnh hưởng. |
| Request không qua proxy | Kiểm tra `HTTPS_PROXY` đã set khi start gateway chưa. Restart sau khi đổi env. |
| Docker container không đọc được credentials | Đảm bảo mount `~/.claude/.credentials.json:/app/data/claude-credentials.json:ro` đúng; với non-root user, chỉnh path host cho phù hợp. |
| Dashboard hiện 0 request dù client đang dùng | Kiểm tra `data/ccg.db` có quyền ghi; xem log `metrics`/`usage-parser` để bắt lỗi parse usage block. |
| MCP request không đi qua gateway | `mcp-proxy.anthropic.com` hard-code, không theo `ANTHROPIC_BASE_URL`. Dùng Clash chặn nếu không cần MCP. |

Log:
- Local: stdout của `npm run dev`.
- Docker: `docker compose logs -f gateway`.
- Health check: `GET /_health`.

---

Log:
- Local: stdout của `npm run dev`.
- Docker: `docker compose logs -f gateway`.
- Health check: `GET /_health`.

---

## 7. Các bước rút gọn

**Local, một mình, một máy:**
```bash
npm install && bash scripts/quick-setup.sh
npm run add-user:dev -- admin    # tạo user dashboard
./clients/cc-<hostname> install
ccg
# mở http://localhost:8443 để xem dashboard
```

**Server Docker, nhiều client:**
```bash
bash scripts/admin-setup.sh
docker compose exec gateway node dist/scripts/add-user.js admin
# Dashboard: Accounts -> thêm account; Clients -> + Add client, gán account
# gửi file launcher đã tải cho Alice (không cần restart)
```

Xem [`README.md`](README.md) để biết chi tiết về cơ chế rewrite, OAuth lifecycle, Clash rules và các caveat.
