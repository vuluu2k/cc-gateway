# CC Gateway

Gateway đứng giữa Claude Code và Anthropic API, cho một nhóm người dùng chung **nhiều account Claude** qua một chỗ quản lý duy nhất:

- Nhiều account Claude trong một server, mỗi account mang danh tính riêng (`device_id`, email, fingerprint môi trường) và tuỳ chọn ra Internet qua proxy riêng.
- Mỗi client (người dùng) có token riêng, được gán một hoặc nhiều account theo thứ tự ưu tiên, kèm hạn mức chi phí cho từng cặp client–account. Hết hạn mức ở account này thì tự chuyển sang account kế tiếp.
- Dashboard web: thêm account và **đăng nhập lại ngay trên web**, tạo client, gán account, xem chi phí theo client/account và quota 5 giờ / theo tuần của từng account.
- Toàn bộ trạng thái nằm trong SQLite ở `data/`; restart hay deploy lại không mất dữ liệu.
- Người dùng chỉ cài một launcher và dùng Claude Code như bình thường.

Bản trực quan (sơ đồ tuyến, phần thử chọn account, vòng đời account): tải [`docs/how-it-works.html`](docs/how-it-works.html) về và mở bằng trình duyệt. Hướng dẫn vận hành chi tiết: [`README.vi.md`](README.vi.md). Deploy lên VPS bằng GitHub Actions: [`deploy/vps/README.md`](deploy/vps/README.md).

## Cách hoạt động

Người dùng vẫn chạy Claude Code như cũ. Gateway đứng giữa: chọn một account Claude còn dùng được, đổi danh tính của request cho khớp account đó, rồi gửi lên Anthropic bằng token OAuth của account đó.

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

## Gateway sửa gì trong request

Mọi giá trị dưới đây lấy theo **account được chọn** cho request đó (account không đặt riêng thì dùng giá trị mẫu trong `config.yaml`).

| Lớp | Trường | Xử lý |
|-----|--------|-------|
| Danh tính | `device_id` trong metadata và event | thay bằng `device_id` của account |
| | `email` | thay bằng email của account |
| Môi trường | object `env` (hơn 40 trường) | thay nguyên object |
| Tiến trình | `constrainedMemory`, `rss`, `heapTotal`, `heapUsed` | đưa về giá trị/khoảng cố định |
| Header | `User-Agent` | phiên bản Claude Code chuẩn (tự cập nhật hằng ngày) |
| | `x-api-key` của client | thay bằng access token OAuth của account |
| | `x-anthropic-billing-header` | bỏ hẳn |
| Prompt | `Platform`, `Shell`, `OS Version`, `Working directory` | thay bằng `prompt_env` |
| | đường dẫn `/Users/xxx/`, `/home/xxx/`, `C:\Users\xxx\` | che thành đường dẫn chuẩn, đổi ngược lại trong câu trả lời |
| Telemetry | `baseUrl`, `gateway` | bỏ, để không lộ việc đi qua gateway |

## Cài đặt

### Docker trên server trắng

Không cần đăng nhập Claude trên máy chủ, không cần mount credentials.

```bash
git clone https://github.com/vuluu2k/cc-gateway.git && cd cc-gateway
docker compose -f deploy/vps/docker-compose.yml up -d --build
docker compose -f deploy/vps/docker-compose.yml logs gateway | grep -i 'setup code'
```

1. Container khởi động với 0 account và in ra **setup code** (dùng một lần, hết hạn sau 24 giờ; restart container để in code mới).
2. Mở `https://<domain>/admin`, nhập username, password và setup code để tạo admin đầu tiên.
3. **Accounts → Add account**, rồi **Re-login**: mở link Claude, duyệt, dán code vào ô bên dưới.
4. **Clients → + Add client** để tạo client và tải launcher; trên hàng của client, bấm **Accounts for this client** để gán account (ưu tiên, hạn mức, kỳ).

Gateway nghe HTTP trên cổng `8443`, mặc định chỉ ở `127.0.0.1`; muốn reverse proxy ở máy khác gọi tới thì đặt `BIND_IP=<IP nội bộ>` trong `deploy/vps/.env`. Đặt một reverse proxy có TLS phía trước (nginx, Caddy, Traefik…) và chuyển tiếp `Host` cùng `X-Forwarded-Proto` (xem [`deploy/vps/nginx-ccg.conf`](deploy/vps/nginx-ccg.conf)). Dữ liệu nằm ở `data/` cạnh repo.

### Deploy tự động lên VPS

Push lên `main` → runner GitHub Actions cài sẵn trên VPS tự backup DB, build và khởi động lại container, rồi kiểm tra `/_health`. Cách cài runner, biến repo và cron backup: [`deploy/vps/README.md`](deploy/vps/README.md). Nếu repo để public, **bắt buộc** bật *Require approval for all external contributors* cho workflow từ fork PR.

### Chạy local để phát triển

Cần Node.js 22+.

```bash
npm install
npm run dev        # tsx watch, tự reload; config mặc định ở ./data/config.yaml
npm test           # toàn bộ test (tsx + assert)
npm run build      # biên dịch ra dist/
```

Trên macOS đã đăng nhập Claude Code, `bash scripts/quick-setup.sh` lấy credentials từ Keychain, tạo `config.yaml` và một launcher; lần khởi động đầu, account đó được nhập vào DB thành account `default`.

## Dùng cho client

Admin gửi file launcher `cc-<tên>` tải từ dashboard. Người dùng chạy:

```bash
chmod +x cc-alice
./cc-alice install        # cài thành lệnh 'ccg'
ccg                       # chạy Claude Code qua gateway
```

```
ccg                       Chạy Claude Code qua gateway (mọi tham số của claude đều dùng được)
ccg install / uninstall   Cài / gỡ lệnh 'ccg'
ccg hijack / release      Cho 'claude' cũng đi qua gateway / trả lại như cũ
ccg native [args]         Chạy claude gốc một lần, không qua gateway
ccg status                Kiểm tra kết nối tới gateway
```

Hạn mức còn lại theo từng account: `https://<domain>/portal`.

## Cấu hình

`data/config.yaml` được tạo tự động lần đầu và chỉ chứa phần cấu hình tĩnh:

| Khoá | Ý nghĩa |
|------|---------|
| `server.port`, `server.tls` | cổng nghe; TLS nếu không có reverse proxy phía trước |
| `upstream.url` | mặc định `https://api.anthropic.com` |
| `identity`, `env`, `prompt_env`, `process` | danh tính và fingerprint **mẫu** cho account mới; từng account ghi đè được trên dashboard |
| `logging`, `db.path` | mức log; đường dẫn SQLite |

Account, client, gán account và hạn mức **không** nằm trong `config.yaml` mà trong DB, quản lý trên dashboard. Khoá `oauth` / `auth.tokens` cũ chỉ được đọc một lần để chuyển bản cài một-account sang DB.

| Biến môi trường | Tác dụng |
|-----------------|----------|
| `CCG_CONFIG_PATH` | đường dẫn `config.yaml` (mặc định `/app/data/config.yaml`) |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | proxy chung cho account không đặt `proxy_url` riêng |
| `CCG_REFRESH_TOKEN` (hoặc `CCG_CREDENTIALS_PATH`) | tuỳ chọn: tạo sẵn account đầu tiên trên server mới, khỏi đăng nhập trên web |
| `CCG_DISABLE_VERSION_AUTOUPDATE` | tắt việc tự cập nhật phiên bản Claude Code giả lập |

## Lưu ý

- **Không tự chuyển account khi Anthropic báo lỗi.** Account bị Anthropic giới hạn (429) hoặc hết phiên (401) làm request đó lỗi thật; chỉ hết *hạn mức do bạn đặt* mới chuyển account.
- **Chung IP.** Account không đặt `proxy_url` đều đi ra bằng IP của server. Muốn tách IP cho từng account, đặt proxy HTTP(S) riêng (không hỗ trợ SOCKS).
- **MCP chính thức** (`mcp-proxy.anthropic.com`) không đi theo `ANTHROPIC_BASE_URL`, nên không qua gateway. Có thể chặn bằng Clash: mẫu ở [`clash-rules.yaml`](clash-rules.yaml).
- **Bản Claude Code mới** có thể thêm trường telemetry hoặc endpoint mới; kiểm tra lại sau khi nâng cấp.
- **Mọi máy nên đi qua gateway**, kể cả máy admin, để không lộ thêm một fingerprint khác cho cùng account.

## License

MIT, xem [`LICENSE`](LICENSE).
