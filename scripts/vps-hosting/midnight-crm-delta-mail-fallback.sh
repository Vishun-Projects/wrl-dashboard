#!/usr/bin/env bash
# 07:05 IST safety net — SUCCESS regional mail if verify OK, FAILED if job died.
# Skip while the 00:00 job still holds the lock (it mails at 07:00).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
TODAY="$(TZ=Asia/Kolkata date +%F)"

if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
  AS_OF="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
else
  AS_OF="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
fi

MARKER="${INSTALL_ROOT}/shared/logs/midnight-crm-delta-mailed-${TODAY}"
VERIFY_OK="${INSTALL_ROOT}/shared/logs/midnight-crm-verify-ok-${AS_OF}"
LOCK="${INSTALL_ROOT}/shared/logs/midnight-crm-delta.lock"

if [[ -f "$MARKER" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback — SUCCESS mail already sent"
  exit 0
fi

lock_pid=""
if [[ -f "$LOCK" ]]; then
  lock_pid=$(cat "$LOCK" 2>/dev/null || true)
fi
if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback — 07:00 job still running (pid ${lock_pid})"
  exit 0
fi

if [[ ! -f "$VERIFY_OK" ]]; then
  echo "FATAL: 07:05 fallback — verify marker missing and midnight sync is not running" >&2
  FAIL_ALERTED=0
  # shellcheck source=midnight-regional-fail-mail.inc.sh
  source "${SCRIPT_DIR}/midnight-regional-fail-mail.inc.sh"
  send_midnight_regional_fail_mail "07:05 fallback — verify marker missing and midnight sync is not running"
  exit 1
fi

echo "[$(TZ=Asia/Kolkata date -Iseconds)] FALLBACK SUCCESS mail — verify OK, 07:00 job did not send"
exec bash "${SCRIPT_DIR}/midnight-crm-delta-mail.sh"
