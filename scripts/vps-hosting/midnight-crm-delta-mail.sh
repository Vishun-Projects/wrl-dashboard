#!/usr/bin/env bash
# Midnight CRM delta MAIL — after successful midnight sync (or 07:30 fallback cron).
# Always attempts the report mail when invoked.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
_LOG_ROOT="$INSTALL_ROOT"
CODE_ROOT="$INSTALL_ROOT"
if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
  CODE_ROOT="${INSTALL_ROOT}/current"
fi
cd "$CODE_ROOT"
mkdir -p "${INSTALL_ROOT}/shared/logs" "${CODE_ROOT}/logs"

if [[ -f "${INSTALL_ROOT}/shared/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/shared/.env.mis-email")
  set +a
elif [[ -f "${CODE_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${CODE_ROOT}/.env.mis-email")
  set +a
else
  echo "FATAL: missing .env.mis-email" >&2
  exit 1
fi

export NODE_ENV=production
# YTD register workbook ~230k+ rows — 8GB was tight when two mailers raced (exit 137).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=12288}"
export TZ="${TZ:-Asia/Kolkata}"
TODAY="$(TZ=Asia/Kolkata date +%F)"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"

MAIL_MARKER="${_LOG_ROOT}/shared/logs/midnight-crm-delta-mailed-${TODAY}"
MAIL_LOCK="${_LOG_ROOT}/shared/logs/midnight-crm-delta-mail.lock"
mkdir -p "$(dirname "$MAIL_MARKER")"

if [[ -f "$MAIL_MARKER" && "${MIDNIGHT_MAIL_FORCE:-}" != "1" ]]; then
  echo "[${STAMP}] SKIP — CRM delta mail already sent today"
  echo "=== midnight-crm-delta complete ==="
  exit 0
fi

# Don't send SUCCESS after a 07:30 FAILED for the same AS_OF (unless force heal).
if [[ -z "${MIDNIGHT_SYNC_AS_OF:-}" ]]; then
  if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
    _fail_as_of="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
  else
    _fail_as_of="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
  fi
else
  _fail_as_of="$MIDNIGHT_SYNC_AS_OF"
fi
_fail_marker="${_LOG_ROOT}/shared/logs/midnight-regional-fail-mailed-${_fail_as_of}"
if [[ -f "$_fail_marker" && "${MIDNIGHT_MAIL_FORCE:-}" != "1" ]]; then
  echo "[${STAMP}] SKIP — FAILED already mailed for AS_OF=${_fail_as_of}"
  echo "=== midnight-crm-delta complete ==="
  exit 0
fi

# One workbook at a time — primary + fallback used to double-start at 07:30 → OOM 137.
exec 9>"$MAIL_LOCK"
if ! flock -n 9; then
  echo "[${STAMP}] SKIP — another midnight CRM delta mailer holds ${MAIL_LOCK}"
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

cd "$CODE_ROOT"

set +e
npm run mis-email:midnight-crm-delta
rc=$?
set -e

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: midnight CRM delta mail exited with code ${rc}" >&2
  exit "$rc"
fi

touch "$MAIL_MARKER"

echo "=== midnight-crm-delta complete ==="
