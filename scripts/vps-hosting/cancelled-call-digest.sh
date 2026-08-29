#!/usr/bin/env bash
# Cancelled-call digest (manual / evening-ops / portal test).
# No standalone */15 cron — evening-ops-sequencer runs the ops probe at 16:00 IST.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

if [[ "$(TZ=Asia/Kolkata date +%u)" == "7" ]]; then
  echo "=== cancelled-call-digest skipped — Sunday (IST) ==="
  exit 0
fi

LOCK_FILE="${INSTALL_ROOT}/logs/cancelled-call-digest.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== cancelled-call-digest skipped — already running (pid ${lock_pid}) ==="
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-email"
  set +a
else
  echo "FATAL: missing ${INSTALL_ROOT}/.env.mis-email" >&2
  exit 1
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

echo "=== cancelled-call-digest $(date -Iseconds) TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow cancelled_call_digest || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

npm run mis-email:cancelled-call-digest
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: cancelled-call-digest exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== cancelled-call-digest complete ==="
