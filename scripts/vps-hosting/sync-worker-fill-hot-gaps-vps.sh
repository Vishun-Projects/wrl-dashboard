#!/usr/bin/env bash
# Gap-fill missing CRM corpus rows into calls_latest_hot (no truncate).
# Asks for SSH passphrase; runs on VPS under nohup.
#
#   npm run sync-worker:fill-hot-gaps:vps
#   SYNC_HOT_GAPS_FROM=2025-11-01 SYNC_HOT_GAPS_TO=2025-12-31 npm run sync-worker:fill-hot-gaps:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
FROM_DATE="${SYNC_HOT_GAPS_FROM:-2020-01-01}"
TO_DATE="${SYNC_HOT_GAPS_TO:-}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
  -i "${SSH_KEY}"
)

if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
  echo "ERROR: need interactive terminal for SSH passphrase." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)"
fi
echo "==> Enter SSH key passphrase for ${SSH_KEY}"
ssh-add "$SSH_KEY"

detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
fi
echo "    host=${VPS_HOST}  root=${INSTALL_ROOT}"

echo "==> Syncing fill-hot-gaps code…"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/src/lib/read-model'"
if command -v rsync >/dev/null 2>&1; then
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/lib/read-model/fill-hot-gaps.ts" \
    "${ROOT}/src/lib/read-model/cli.ts" \
    "${ROOT}/src/lib/read-model/crm-fetch.ts" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/read-model/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/package.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/package.json"
else
  scp "${SSH_OPTS[@]}" \
    "${ROOT}/src/lib/read-model/fill-hot-gaps.ts" \
    "${ROOT}/src/lib/read-model/cli.ts" \
    "${ROOT}/src/lib/read-model/crm-fetch.ts" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/read-model/"
  scp "${SSH_OPTS[@]}" "${ROOT}/package.json" "${VPS_HOST}:${INSTALL_ROOT}/package.json"
fi

LOG_REL="logs/fill-hot-gaps-$(date +%Y%m%d-%H%M%S).log"

echo "==> Stopping prior fill-hot-gaps (if any)…"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'pkill -f "[c]li.ts fill-hot-gaps" 2>/dev/null || true; sleep 1; pgrep -af "[c]li.ts fill-hot-gaps" || echo "(none)"'

TO_ARG=""
if [[ -n "$TO_DATE" ]]; then
  TO_ARG="--to ${TO_DATE}"
fi

echo "==> Starting fill-hot-gaps on VPS (${FROM_DATE} .. ${TO_DATE:-day-before-YTD})"
echo "    log: ${INSTALL_ROOT}/${LOG_REL}"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
cd '${INSTALL_ROOT}'
mkdir -p logs

if [[ -f .env.sync-worker ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r\$//' .env.sync-worker)
  set +a
elif [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r\$//' .env.local)
  set +a
fi

export NODE_OPTIONS="\${NODE_OPTIONS:---max-old-space-size=6144}"
export SYNC_WORKER_ENABLED=true
export SYNC_BACKFILL_CHUNK_DAYS=1
export SYNC_CRM_SHARD_FIRST=true
export SYNC_BACKFILL_FETCH_GAP_MS="\${SYNC_BACKFILL_FETCH_GAP_MS:-3000}"
export SYNC_CRM_FETCH_GAP_MS="\${SYNC_CRM_FETCH_GAP_MS:-3000}"

if pgrep -f '[c]li.ts fill-hot-gaps' >/dev/null 2>&1; then
  echo "FATAL: fill-hot-gaps already running" >&2
  exit 1
fi

nohup npx tsx src/lib/read-model/cli.ts fill-hot-gaps --from '${FROM_DATE}' ${TO_ARG} > '${LOG_REL}' 2>&1 &
echo "PID \$!"
sleep 4
head -n 40 '${LOG_REL}' || true
REMOTE

echo ""
echo "Running on VPS (nohup). Safe to close PC."
echo "Tail: ssh ${VPS_HOST} 'tail -f ${INSTALL_ROOT}/${LOG_REL}'"
