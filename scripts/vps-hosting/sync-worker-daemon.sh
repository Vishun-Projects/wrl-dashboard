#!/usr/bin/env bash
# CRM read-model sync — long-running daemon (incremental every 3 min by default).
# Managed by systemd: fast-close-sync-worker.service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

# systemd often has no HOME with set -u — don't explode
HOME="${HOME:-/root}"
export HOME

# systemd has a minimal PATH — include common Node installs
PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  latest_node="$(ls -1 "${HOME}/.nvm/versions/node" 2>/dev/null | tail -1 || true)"
  if [[ -n "${latest_node}" && -d "${HOME}/.nvm/versions/node/${latest_node}/bin" ]]; then
    PATH="${HOME}/.nvm/versions/node/${latest_node}/bin:${PATH}"
  fi
fi
export PATH

load_env_file() {
  local file="$1"
  # Strip Windows CRLF so SYNC_WORKER_ENABLED=true\r does not fail the equality check
  set -a
  # shellcheck disable=SC1090
  source <(sed 's/\r$//' "$file")
  set +a
}

ENV_CANDIDATES=(
  "${INSTALL_ROOT}/.env.sync-worker"
  "${INSTALL_ROOT}/.env.local"
  "/opt/fast-close-app/.env.sync-worker"
  "/opt/wrl/database/fast-close-app/.env.sync-worker"
)

ENV_FILE=""
for candidate in "${ENV_CANDIDATES[@]}"; do
  if [[ -f "$candidate" ]]; then
    ENV_FILE="$candidate"
    break
  fi
done

if [[ -z "$ENV_FILE" ]]; then
  echo "FATAL: missing .env.sync-worker under ${INSTALL_ROOT} (also checked /opt/fast-close-app)" >&2
  echo "  Create it: cp scripts/vps-hosting/.env.sync-worker.example .env.sync-worker" >&2
  echo "  Then set DATABASE_URL and SYNC_WORKER_ENABLED=true" >&2
  exit 1
fi

if [[ "$ENV_FILE" != "${INSTALL_ROOT}/.env.sync-worker" ]]; then
  echo "WARN: using ${ENV_FILE} (copy to ${INSTALL_ROOT}/.env.sync-worker to silence)" >&2
fi

load_env_file "$ENV_FILE"

export NODE_ENV=production

# Trim accidental whitespace/CR from flags
SYNC_WORKER_ENABLED="$(echo -n "${SYNC_WORKER_ENABLED:-}" | tr -d '\r' | xargs || true)"

if [[ "${SYNC_WORKER_ENABLED}" != "true" ]]; then
  echo "FATAL: SYNC_WORKER_ENABLED must be true in ${ENV_FILE} (got: '${SYNC_WORKER_ENABLED:-}')" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL is empty in ${ENV_FILE}" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH=${PATH}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node not found on PATH=${PATH}" >&2
  exit 1
fi

interval_ms="${SYNC_INTERVAL_MS:-180000}"
echo "=== sync-worker-daemon $(date -Iseconds) TZ=${TZ:-system} interval=${interval_ms}ms node=$(node -v) env=${ENV_FILE} ==="

exec npm run sync-worker:daemon
