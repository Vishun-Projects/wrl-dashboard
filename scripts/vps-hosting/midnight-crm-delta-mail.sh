#!/usr/bin/env bash
# Midnight CRM delta MAIL — after successful midnight sync (or 07:30 fallback cron).
# Always attempts the report mail when invoked.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

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
else
  echo "FATAL: missing .env.mis-email" >&2
  exit 1
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export TZ="${TZ:-Asia/Kolkata}"
TODAY="$(TZ=Asia/Kolkata date +%F)"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"

MAIL_MARKER="${INSTALL_ROOT}/shared/logs/midnight-crm-delta-mailed-${TODAY}"
if [[ ! -d "${INSTALL_ROOT}/shared/logs" ]]; then
  MAIL_MARKER="${INSTALL_ROOT}/logs/midnight-crm-delta-mailed-${TODAY}"
fi
if [[ -f "$MAIL_MARKER" && "${MIDNIGHT_MAIL_FORCE:-}" != "1" ]]; then
  echo "[${STAMP}] SKIP — CRM delta mail already sent today"
  echo "=== midnight-crm-delta complete ==="
  exit 0
fi

# Don't send SUCCESS after a 07:30 FAILED for the same AS_OF.
if [[ -z "${MIDNIGHT_SYNC_AS_OF:-}" ]]; then
  if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
    _fail_as_of="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
  else
    _fail_as_of="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
  fi
else
  _fail_as_of="$MIDNIGHT_SYNC_AS_OF"
fi
_fail_marker="${INSTALL_ROOT}/shared/logs/midnight-regional-fail-mailed-${_fail_as_of}"
if [[ -f "$_fail_marker" && "${MIDNIGHT_MAIL_FORCE:-}" != "1" ]]; then
  echo "[${STAMP}] SKIP — FAILED already mailed for AS_OF=${_fail_as_of}"
  echo "=== midnight-crm-delta complete ==="
  exit 0
fi

echo "=== midnight-crm-delta mail $(TZ=Asia/Kolkata date -Iseconds) TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow midnight_crm_delta_mail || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

# Always send when this script is invoked.
set +e
npm run mis-email:midnight-crm-delta
rc=$?
set -e

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: midnight CRM delta mail exited with code ${rc}" >&2
  exit "$rc"
fi

mkdir -p "$(dirname "$MAIL_MARKER")"
touch "$MAIL_MARKER"

echo "=== midnight-crm-delta complete ==="
