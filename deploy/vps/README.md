# Deploy lên VPS webcake-ai

```
Client ──https──▶ nginx-01 (OpenResty, TLS, auto-ssl) ──http──▶ webcake-ai 10.1.5.200:8443 ──▶ container cc-gateway
```

| File | Dùng ở đâu |
|------|-----------|
| `docker-compose.yml` | webcake-ai: build từ `Dockerfile` gốc, bind `BIND_IP:8443`, dữ liệu ở `~/cc-gateway/data` |
| `backup.sh` | webcake-ai: backup `ccg.db` (trước mỗi lần deploy + cron 03:00), mỗi lần một file theo timestamp, giữ 14 bản |
| `nginx-ccg.conf` | nginx-01: `/usr/local/openresty/nginx/conf/sites/` |
| `../../.github/workflows/deploy-vps.yml` | Tự deploy khi push `main` qua runner self-hosted trên webcake-ai |

## Dữ liệu

Mọi trạng thái (`ccg.db`: account, token OAuth, client, binding, metrics; `config.yaml`; `backups/`)
nằm ở `~/cc-gateway/data` trên VPS. Workflow chỉ thay `src/`, `deploy/`, `tests/` — không bao giờ
đụng `data/`, nên restart, rebuild, redeploy đều không mất dữ liệu.

Backup tên `ccg-<UTC timestamp>.db`, nên deploy lần hai hay cron 03:00 không ghi đè bản trước deploy.
Khi container không chạy hoặc đang restart liên tục (`exec` lỗi), `backup.sh` không chặn deploy sửa lỗi:
nó copy thô `ccg.db` cùng `-wal`/`-shm` thành `ccg-<timestamp>-raw.db*`, và chỉ fail khi copy thô cũng lỗi.

Khôi phục một bản backup:

```bash
cd ~/cc-gateway/deploy/vps
docker compose stop gateway
sudo rm -f ../../data/ccg.db-wal ../../data/ccg.db-shm
sudo cp ../../data/backups/ccg-<timestamp>.db ../../data/ccg.db
# Bản -raw: copy kèm file -wal/-shm nếu có
# sudo cp ../../data/backups/ccg-<timestamp>-raw.db-wal ../../data/ccg.db-wal
docker compose start gateway
```

## Cài đặt một lần

1. **Runner** (user `cc`, giống `webcake_bot`): *Settings → Actions → Runners → New self-hosted runner*,
   giải nén vào `~/actions-runner-ccg`, `./config.sh --labels cc-gateway`, rồi
   `sudo ./svc.sh install cc && sudo ./svc.sh start`.
2. **Biến repo**: `BIND_IP=10.1.5.200` (và tuỳ chọn `HOST_PORT`, mặc định `8443`).
   Tạo environment `production` (*Settings → Environments*).
3. **Cron backup**: `crontab -e` → `0 3 * * * sh /home/cc/cc-gateway/deploy/vps/backup.sh >> /home/cc/cc-gateway/data/backup.log 2>&1`
4. **nginx-01**: copy `nginx-ccg.conf` thành `sites/ccg-toolvn.conf`, thay `SERVER_NAME`,
   `sudo openresty -t && sudo openresty -s reload`. DNS của domain trỏ về IP public của nginx-01.

5. **Bắt buộc, repo public**: *Settings → Actions → General → Fork pull request workflows* phải đặt
   **"Require approval for all external contributors"** và giữ nguyên như vậy.

> ⚠️ Runner self-hosted trên repo public: việc `deploy-vps.yml` không có trigger `pull_request` **không**
> bảo vệ được gì. Một PR từ fork có thể tự thêm file workflow riêng với `runs-on: [self-hosted, cc-gateway]`,
> và GitHub chạy workflow nằm trong chính PR đó trên runner này. User `cc` có quyền docker (tương đương
> root), VPS giữ token OAuth của mọi account Claude và nằm trong mạng nội bộ 10.1.5.x. Thứ duy nhất chặn
> việc đó là setting duyệt fork PR ở bước 5 — đừng bao giờ hạ nó xuống (mặc định của GitHub chỉ duyệt
> người đóng góp lần đầu). Cách chắc hơn: chuyển repo sang private, hoặc chạy runner bằng user không có
> quyền docker.

## Lần chạy đầu

Container khởi động không cần credentials. Lấy setup code để tạo admin đầu tiên:

```bash
docker logs cc-gateway 2>&1 | grep -i 'setup code'
```

Mở `https://<domain>/admin`, nhập username, password và setup code. Code chỉ dùng một lần và hết hạn
sau 24 giờ; hết hạn thì `docker restart cc-gateway` để in code mới. Sau đó vào mục Accounts để thêm
tài khoản Claude, rồi gán account cho từng client trong mục Clients.

## Lệnh hay dùng (trên VPS)

```bash
cd ~/cc-gateway/deploy/vps
docker compose logs -f --tail 200 gateway
docker compose ps
sh backup.sh
```
