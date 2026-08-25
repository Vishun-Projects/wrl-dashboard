#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

ssh "$VPS_HOST" "INSTALL_BASE='${INSTALL_BASE}' bash -s" <<'REMOTE'
set -euo pipefail
base="${INSTALL_BASE:-/opt/fast-close-app}"
base="${base%/current}"
# Prefer release layout
for candidate in "$base" /opt/wrl/database/fast-close-app /opt/fast-close-app; do
  if [[ -e "${candidate}/current/scripts/vps-hosting/mis-email-digest.sh" ]]; then
    base="$candidate"
    break
  fi
done
if [[ -e "${base}/current/scripts/vps-hosting/mis-email-digest.sh" ]]; then
  code="${base}/current"
else
  code="$base"
fi
log_dir="${base}/shared/logs"
[[ -d "$log_dir" ]] || log_dir="${code}/logs"

echo "base=${base}"
echo "current=$(readlink "${base}/current" 2>/dev/null || echo '(flat)')"
echo "previous=$(readlink "${base}/previous" 2>/dev/null || echo '(none)')"
echo "--- systemd ---"
systemctl --no-pager status fast-close-sync-worker || true
echo '--- nightly timer ---'
systemctl --no-pager list-timers fast-close-sync-worker-nightly.timer 2>/dev/null || true
echo '--- nightly log ---'
tail -n 10 "${log_dir}/sync-worker-nightly.log" 2>/dev/null || echo '(no nightly log yet)'
echo '--- sync log ---'
tail -n 20 "${log_dir}/sync-worker.log" 2>/dev/null || true
if [[ -f "${base}/release-history" ]]; then
  echo '--- release-history (newest first) ---'
  head -n 5 "${base}/release-history"
fi
REMOTE
