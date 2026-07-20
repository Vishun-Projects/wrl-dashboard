#!/usr/bin/env bash
# CRM read-model sync — long-running daemon (incremental every 3 min by default).
# Managed by systemd: fast-close-sync-worker.service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "${INSTALL_ROOT}/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.sync-worker"
  set +a
elif [[ -f "${INSTALL_ROOT}/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.local"
  set +a
else
  echo "FATAL: missing ${INSTALL_ROOT}/.env.sync-worker (or .env.local)" >&2
  exit 1
fi

export NODE_ENV=production

if [[ "${SYNC_WORKER_ENABLED:-}" != "true" ]]; then
  echo "FATAL: SYNC_WORKER_ENABLED must be true in .env.sync-worker" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

interval_ms="${SYNC_INTERVAL_MS:-180000}"
echo "=== sync-worker-daemon $(date -Iseconds) TZ=${TZ:-system} interval=${interval_ms}ms ==="

exec npm run sync-worker:daemon
