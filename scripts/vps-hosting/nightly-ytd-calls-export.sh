#!/usr/bin/env bash
# Nightly YTD calls export — full register Excel Jan 1 → yesterday, emailed at midnight IST.
# Cron: 0 0 * * * …/nightly-ytd-calls-export.sh >> …/nightly-ytd-export-cron.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

LOCK_FILE="${INSTALL_ROOT}/logs/nightly-ytd-export.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== nightly-ytd-calls-export skipped — already running (pid ${lock_pid}) ==="
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
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

echo "=== nightly-ytd-calls-export $(TZ=Asia/Kolkata date -Iseconds) TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow nightly_ytd_calls_export || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

npm run mis-email:nightly-ytd-export
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: nightly YTD export exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== nightly-ytd-calls-export complete ==="
