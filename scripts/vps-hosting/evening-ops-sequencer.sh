#!/usr/bin/env bash
# Evening ops sequencer — 16:00 IST daily.
# Inventory + probe mails (ops To only) + final OK/FAIL status.
#
#   Cron: 0 16 * * * …/evening-ops-sequencer.sh >> …/evening-ops-sequencer.log
#   npm run mis-email:install-evening-ops:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

LOCK_FILE="${INSTALL_ROOT}/logs/evening-ops-sequencer.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== evening-ops-sequencer skipped — already running (pid ${lock_pid}) ==="
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
elif [[ -f "${INSTALL_ROOT}/../shared/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/../shared/.env.mis-email")
  set +a
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export TZ="${TZ:-Asia/Kolkata}"
export EVENING_OPS_TO="${EVENING_OPS_TO:-vishnu.vishwakarma@westernequipments.com}"

echo "=== evening-ops-sequencer $(TZ=Asia/Kolkata date -Iseconds) TZ=${TZ:-system} to=${EVENING_OPS_TO} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow evening_ops_sequencer || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/evening-ops-sequencer.ts" ]]; then
  echo "FATAL: missing ${SCRIPT_DIR}/evening-ops-sequencer.ts" >&2
  exit 1
fi

npx tsx "${SCRIPT_DIR}/evening-ops-sequencer.ts"
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: evening-ops-sequencer exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== evening-ops-sequencer complete ==="
