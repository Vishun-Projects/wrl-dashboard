#!/usr/bin/env bash
# Full historical hot backfill on VPS (default 2020-01-01 .. day before YTD).
# Asks for SSH passphrase, stops any prior run, starts a CRM-gentle job (nohup).
#
#   npm run sync-worker:backfill-historical:vps
#
# Defaults favour CRM health over speed:
#   7-day windows (usually succeed without timeout→retry)
#   3s gap between CRM POSTs (+ same gap on shard/split retries)
#
# Optional:
#   SYNC_HISTORICAL_START_DATE=2024-01-01
#   SYNC_BACKFILL_CHUNK_DAYS=7
#   SYNC_BACKFILL_FETCH_GAP_MS=3000
#   SYNC_CRM_FETCH_GAP_MS=3000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
CHUNK_DAYS="${SYNC_BACKFILL_CHUNK_DAYS:-7}"
HIST_START="${SYNC_HISTORICAL_START_DATE:-2020-01-01}"
BACKFILL_GAP_MS="${SYNC_BACKFILL_FETCH_GAP_MS:-3000}"
CRM_GAP_MS="${SYNC_CRM_FETCH_GAP_MS:-3000}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
  -i "${SSH_KEY}"
)

if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
  echo "ERROR: need an interactive terminal for the SSH passphrase." >&2
  echo "  Open Git Bash and run: npm run sync-worker:backfill-historical:vps" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "Missing SSH key: ${SSH_KEY}" >&2
  exit 1
fi

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)"
fi
echo "==> Enter SSH key passphrase for ${SSH_KEY}"
ssh-add "$SSH_KEY"

echo "==> Checking VPS…"
detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
fi
echo "    host=${VPS_HOST}  root=${INSTALL_ROOT}"

# Push crm-fetch pacing defaults so VPS matches repo (env still overrides below).
echo "==> Syncing crm-fetch.ts to VPS…"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/src/lib/read-model'"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/src/lib/read-model/crm-fetch.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/lib/read-model/crm-fetch.ts"

LOG_REL="logs/backfill-historical-$(date +%Y%m%d-%H%M%S).log"

echo "==> Stopping any prior backfill-historical…"
# [c]li trick: pattern must not match this ssh/pkill command line or the session dies under set -e.
ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'pgrep -af "[c]li.ts backfill-historical" || true; pkill -f "[c]li.ts backfill-historical" 2>/dev/null || true; sleep 2; pgrep -af "[c]li.ts backfill-historical" || echo "(none running)"'

echo "==> Starting CRM-gentle backfill-historical on VPS"
echo "    range:  ${HIST_START} .. day-before-YTD"
echo "    chunks: ${CHUNK_DAYS}-day windows"
echo "    gaps:   ${BACKFILL_GAP_MS}ms between chunks, ${CRM_GAP_MS}ms between split/shard POSTs"
echo "    log:    ${INSTALL_ROOT}/${LOG_REL}"

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
export SYNC_BACKFILL_CHUNK_DAYS='${CHUNK_DAYS}'
export SYNC_BACKFILL_FETCH_GAP_MS='${BACKFILL_GAP_MS}'
export SYNC_CRM_FETCH_GAP_MS='${CRM_GAP_MS}'
export SYNC_HISTORICAL_START_DATE='${HIST_START}'
export SYNC_WORKER_ENABLED=true

if pgrep -f '[c]li.ts backfill-historical' >/dev/null 2>&1; then
  echo "FATAL: backfill-historical still running:" >&2
  pgrep -af '[c]li.ts backfill-historical' >&2 || true
  exit 1
fi

nohup npm run sync-worker:backfill-historical > '${LOG_REL}' 2>&1 &
echo "PID \$!"
sleep 4
head -n 60 '${LOG_REL}' || true
REMOTE

echo ""
echo "Running on VPS under nohup — safe to close this PC."
echo "Expect log: chunk(s) × ${CHUNK_DAYS} day(s), gap ${BACKFILL_GAP_MS}ms"
echo "Tail: ssh ${VPS_HOST} 'tail -f ${INSTALL_ROOT}/${LOG_REL}'"
