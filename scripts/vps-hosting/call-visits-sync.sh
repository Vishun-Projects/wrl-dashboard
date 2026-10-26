#!/usr/bin/env bash
# Sync CRM call visits into Postgres. Cron (IST): 0 */2 * * *
# Skips when the previous run still holds the lock.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
CODE_ROOT="$INSTALL_ROOT"
if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
  CODE_ROOT="${INSTALL_ROOT}/current"
fi
cd "$CODE_ROOT"

if ! grep -q 'sync-worker:call-visits' package.json 2>/dev/null; then
  echo "SKIP — this deploy has no sync-worker:call-visits yet"
  exit 0
fi

LOG_DIR="${INSTALL_ROOT}/logs"
if [[ -d "${INSTALL_ROOT}/shared" ]]; then
  LOG_DIR="${INSTALL_ROOT}/shared/logs"
fi
mkdir -p "$LOG_DIR"
LOCK_FILE="${LOG_DIR}/call-visits-sync.lock"

HOME="${HOME:-/root}"
export HOME
PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  latest_node="$(ls -1 "${HOME}/.nvm/versions/node" 2>/dev/null | tail -1 || true)"
  if [[ -n "${latest_node}" && -d "${HOME}/.nvm/versions/node/${latest_node}/bin" ]]; then
    PATH="${HOME}/.nvm/versions/node/${latest_node}/bin:${PATH}"
  fi
fi
export PATH
export TZ="${TZ:-Asia/Kolkata}"
export NODE_ENV="${NODE_ENV:-production}"

load_env() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$f")
  set +a
  return 0
}

load_env "${CODE_ROOT}/.env.sync-worker" \
  || load_env "${INSTALL_ROOT}/.env.sync-worker" \
  || load_env "${CODE_ROOT}/.env.local" \
  || load_env "/opt/fast-close-app/.env.sync-worker" \
  || load_env "/opt/wrl/database/fast-close-app/.env.sync-worker" \
  || true

echo "=== call-visits-sync $(TZ=Asia/Kolkata date -Iseconds) ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow call_visits_sync || exit 0

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "SKIP — previous call-visits sync still running"
  exit 0
fi

npm run sync-worker:call-visits
