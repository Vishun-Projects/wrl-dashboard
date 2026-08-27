#!/usr/bin/env bash
# Midnight calls sync only — 00:00 IST (CRM delta mail is a separate 00:15 job).
# Cron: 0 0 * * * …/nightly-ytd-calls-export.sh >> …/nightly-ytd-export-cron.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

LOCK_FILE="${INSTALL_ROOT}/logs/midnight-crm-delta.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== midnight-calls-sync skipped — already running (pid ${lock_pid}) ==="
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/.env.mis-email")
  set +a
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export TZ="${TZ:-Asia/Kolkata}"

echo "=== midnight-crm-delta sync-only $(TZ=Asia/Kolkata date -Iseconds) TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow nightly_ytd_calls_export || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

echo "=== midnight calls sync (once) ==="
if bash "${SCRIPT_DIR}/midnight-calls-sync.sh"; then
  echo "=== midnight calls sync ok ==="
else
  echo "FATAL: midnight calls sync failed — mail job at 00:15 will still run" >&2
  exit 1
fi
