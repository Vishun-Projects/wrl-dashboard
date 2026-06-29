#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"
ssh "$VPS_HOST" "systemctl --no-pager status fast-close-sync-worker; echo '---'; tail -n 20 '${INSTALL_ROOT}/logs/sync-worker.log' 2>/dev/null || true"
