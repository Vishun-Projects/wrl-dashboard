#!/usr/bin/env bash
# 07:30 IST hard guarantee — SUCCESS if verify OK, FAILED otherwise.
# Never silent: does NOT skip when the 00:00 job still holds the lock.
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
FAIL_MARKER="${INSTALL_ROOT}/shared/logs/midnight-regional-fail-mailed-${AS_OF}"
VERIFY_OK="${INSTALL_ROOT}/shared/logs/midnight-crm-verify-ok-${AS_OF}"
LOCK="${INSTALL_ROOT}/shared/logs/midnight-crm-delta.lock"

if [[ -f "$MARKER" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback — SUCCESS mail already sent"
  exit 0
fi

if [[ -f "$FAIL_MARKER" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback — FAILED mail already sent"
  exit 0
fi

lock_pid=""
if [[ -f "$LOCK" ]]; then
  lock_pid=$(cat "$LOCK" 2>/dev/null || true)
fi
still_running=0
if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
  still_running=1
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] 07:30 fallback — 00:00 job still running (pid ${lock_pid}); mailing anyway"
fi

if [[ -f "$VERIFY_OK" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] FALLBACK SUCCESS mail — verify OK, primary job did not send"
  exec bash "${SCRIPT_DIR}/midnight-crm-delta-mail.sh"
fi

reason="07:30 hard deadline — verify marker missing"
if [[ "$still_running" == "1" ]]; then
  reason="07:30 hard deadline — verify marker missing; midnight sync still running (pid ${lock_pid})"
fi
echo "FATAL: ${reason}" >&2
FAIL_ALERTED=0
# shellcheck source=midnight-regional-fail-mail.inc.sh
source "${SCRIPT_DIR}/midnight-regional-fail-mail.inc.sh"
send_midnight_regional_fail_mail "$reason"
exit 1
