#!/bin/sh
# Runs ON the VPS: before every deploy (workflow) and daily from cron.
# better-sqlite3 .backup() is safe while the gateway is writing. Keeps the newest 14.
# Pruning runs inside the container because the files are owned by its root user.
cd "$(dirname "$0")" || exit 1
docker compose ps -q gateway | grep -q . || { echo "gateway not running, skipping backup"; exit 0; }
docker compose exec -T gateway node -e '
const fs = require("fs"), dir = "/app/data/backups"
fs.mkdirSync(dir, { recursive: true })
require("better-sqlite3")("/app/data/ccg.db", { fileMustExist: true })
  .backup(`${dir}/ccg-${new Date().toISOString().slice(0, 10)}.db`)
  .then(() => {
    fs.readdirSync(dir).filter((f) => /^ccg-.*\.db$/.test(f)).sort().reverse().slice(14)
      .forEach((f) => fs.rmSync(`${dir}/${f}`))
    console.log("backup ok")
  })
  .catch((e) => { console.error("backup failed:", e.message); process.exit(1) })
'
