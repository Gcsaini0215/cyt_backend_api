#!/bin/bash
# Pull-based deploy for cyt_backend_api (the GitHub Actions secrets for this repo are broken and
# only the repo owner can fix them). Cron runs this every 2 minutes. It only copies files that
# changed since the last deployed commit — never .env, uploads/ or node_modules — syntax-checks
# them, backs up what it overwrites, restarts pm2 and rolls back if the API doesn't come up.
# Install: see deploy/README.md
set -u
SRC=/root/cyt_backend_src
APP=/root/cyt_backend_api
STATE=/root/.cyt_backend_deployed_sha
FAILED=/root/.cyt_backend_failed_sha
LOG=/var/log/cyt-backend-deploy.log
HEALTH=http://127.0.0.1:4000/api/noida-reviews
exec 9>/tmp/cyt-backend-deploy.lock; flock -n 9 || exit 0
log(){ echo "[$(date -u "+%F %T")] $*" >> "$LOG"; }

cd "$SRC" || { log "no source clone"; exit 1; }
git fetch -q origin main || { log "git fetch failed"; exit 1; }
NEW=$(git rev-parse origin/main)
OLD=$(cat "$STATE" 2>/dev/null)
[ -z "$OLD" ] && { log "no deployed-sha state; refusing to guess"; exit 1; }
[ "$NEW" = "$OLD" ] && exit 0
[ "$NEW" = "$(cat "$FAILED" 2>/dev/null)" ] && exit 0      # failed once already; wait for a new commit
git checkout -q --detach "$NEW" || { log "checkout $NEW failed"; exit 1; }

FILES=$(git diff --name-only --diff-filter=AMRT "$OLD" "$NEW" | grep -vE "^(\.github/|uploads/|node_modules/|deploy/)|\.log$|(^|/)\.env" || true)
DELETED=$(git diff --name-only --diff-filter=D "$OLD" "$NEW" || true)
[ -n "$DELETED" ] && log "${NEW:0:7}: deleted in git but left on server: $(echo $DELETED)"
if [ -z "$FILES" ]; then echo "$NEW" > "$STATE"; log "${NEW:0:7}: nothing to copy"; exit 0; fi

for f in $FILES; do
  case "$f" in *.js|*.mjs) node --check "$f" 2>>"$LOG" || { log "${NEW:0:7}: syntax error in $f — NOT deployed"; echo "$NEW" > "$FAILED"; exit 1; } ;; esac
done

TS=$(date +%Y%m%d-%H%M%S); BK=/root/cyt_backend_pre-auto-$TS.tgz
EXIST=$(cd "$APP" && for f in $FILES; do [ -e "$f" ] && echo "$f"; done)
ADDED=$(cd "$APP" && for f in $FILES; do [ -e "$f" ] || echo "$f"; done)
if [ -n "$EXIST" ]; then (cd "$APP" && tar -czf "$BK" $EXIST) || { log "${NEW:0:7}: backup failed — NOT deployed"; exit 1; }; fi

git archive "$NEW" $FILES | tar -x -C "$APP" || { log "${NEW:0:7}: copy failed"; exit 1; }
if echo "$FILES" | grep -qE "^package(-lock)?\.json$"; then (cd "$APP" && npm install --production >>"$LOG" 2>&1) || log "${NEW:0:7}: npm install reported an error"; fi
pm2 restart cyt_backend >/dev/null 2>&1

ok=0; for i in $(seq 1 24); do sleep 5; [ "$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH")" = "200" ] && { ok=1; break; }; done
if [ "$ok" = 1 ]; then
  echo "$NEW" > "$STATE"; log "deployed ${OLD:0:7}..${NEW:0:7}: $(echo $FILES | wc -w) file(s); backup $BK"
else
  log "${NEW:0:7}: API unhealthy after restart — ROLLING BACK"
  (cd "$APP" && { [ -f "$BK" ] && tar -xzf "$BK"; true; } && for f in $ADDED; do rm -f "$f"; done)
  pm2 restart cyt_backend >/dev/null 2>&1
  echo "$NEW" > "$FAILED"
fi
