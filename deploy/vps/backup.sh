#!/bin/sh
# Runs ON the VPS: before every deploy (workflow) and daily from cron. Keeps the newest 14.
#
# Normal path: better-sqlite3 .backup() inside the container, safe while the gateway writes.
# Fallback (container stopped, or restart-looping so exec fails): copy ccg.db and its
# -wal/-shm raw from the host as ccg-<ts>-raw.db*. A broken container must not block the
# deploy that would fix it, so this only fails when even the raw copy fails.
cd "$(dirname "$0")" || exit 1
DATA=../../data
DIR=$DATA/backups
TS=$(date -u +%Y-%m-%dT%H%M%SZ)

[ -f "$DATA/ccg.db" ] || { echo "no database yet, skipping backup"; exit 0; }

# The container runs as root: hand the backups dir to this (runner) user so the raw
# fallback and the pruning below can write to it.
if docker compose ps -q gateway | grep -q . &&
  docker compose exec -T -e TS="$TS" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" gateway node -e '
const fs = require("fs"), dir = "/app/data/backups"
fs.mkdirSync(dir, { recursive: true })
fs.chownSync(dir, Number(process.env.HOST_UID), Number(process.env.HOST_GID))
require("better-sqlite3")("/app/data/ccg.db", { fileMustExist: true })
  .backup(`${dir}/ccg-${process.env.TS}.db`)
  .then(() => console.log("backup ok"))
  .catch((e) => { console.error("backup failed:", e.message); process.exit(1) })
'; then
  :
else
  echo "container backup unavailable, copying the database files raw"
  mkdir -p "$DIR" && cp "$DATA/ccg.db" "$DIR/ccg-$TS-raw.db" || { echo "raw backup failed"; exit 1; }
  for ext in wal shm; do
    if [ -f "$DATA/ccg.db-$ext" ]; then
      cp "$DATA/ccg.db-$ext" "$DIR/ccg-$TS-raw.db-$ext" || { echo "raw backup failed"; exit 1; }
    fi
  done
  echo "raw backup ok: $DIR/ccg-$TS-raw.db"
fi

# Newest 14 backups of either kind; timestamps sort lexically. A raw copy takes its
# -wal/-shm siblings with it. A pruning error is reported but never fails the deploy.
ls "$DIR" | grep '^ccg-.*\.db$' | sort -r | tail -n +15 | while read -r f; do
  rm -f "$DIR/$f" "$DIR/$f-wal" "$DIR/$f-shm"
done
exit 0
