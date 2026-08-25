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
log_dir="${base}/shared/logs"
if [[ ! -d "$log_dir" ]]; then
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    log_dir="${base}/current/logs"
  else
    log_dir="${base}/logs"
  fi
fi
tail -f "${log_dir}/sync-worker.log"
REMOTE
