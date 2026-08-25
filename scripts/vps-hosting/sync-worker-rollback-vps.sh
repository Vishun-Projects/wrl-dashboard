#!/usr/bin/env bash
# Flip /opt/fast-close-app/current to previous (or SHA=...) and restart sync worker.
#
#   npm run sync-worker:rollback:vps
#   SHA=abc123def456 npm run sync-worker:rollback:vps
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
TARGET_SHA="${SHA:-}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"
detected_base=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<DETECT || true
$(vps_ssh_detect_base_script "$INSTALL_BASE")
DETECT
)
if [[ -n "$detected_base" ]]; then
  INSTALL_BASE="$detected_base"
fi

echo "==> Rollback on ${VPS_HOST} base=${INSTALL_BASE} target=${TARGET_SHA:-previous}"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/vps-release-lib.sh" \
  "${VPS_HOST}:/tmp/vps-release-lib.sh"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "INSTALL_BASE='${INSTALL_BASE}' TARGET_SHA='${TARGET_SHA}' bash -s" <<'REMOTE'
set -euo pipefail
# shellcheck disable=SC1091
source /tmp/vps-release-lib.sh
base="${INSTALL_BASE:?}"
target="${TARGET_SHA:-}"

if [[ ! -L "${base}/current" && ! -d "${base}/current" ]]; then
  echo "ERROR: release layout not found at ${base}/current — deploy once first" >&2
  exit 1
fi

echo "before: current=$(readlink "${base}/current") previous=$(readlink "${base}/previous" 2>/dev/null || echo '?')"
if [[ -n "$target" ]]; then
  vps_rollback_to "$base" "$target"
else
  vps_rollback_to "$base"
fi

systemctl daemon-reload
systemctl restart fast-close-sync-worker
sleep 3
if ! systemctl is-active --quiet fast-close-sync-worker; then
  echo "ERROR: sync worker not active after rollback" >&2
  journalctl -u fast-close-sync-worker -n 30 --no-pager >&2 || true
  exit 1
fi
echo "after:  current=$(readlink -f "${base}/current")"
echo "        previous=$(readlink "${base}/previous" 2>/dev/null || echo '?')"
systemctl --no-pager status fast-close-sync-worker | head -12
echo "Kept releases:"
cat "${base}/release-history" 2>/dev/null || ls "${base}/releases"
REMOTE

echo ""
echo "==> Rollback done. Verify: npm run sync-worker:status:vps"
