#!/usr/bin/env bash
# Morning MIS watchdog — plain language fail/ok for non-techies.
# Cron AFTER the 09:30 digest (default 09:50 IST). Emails YOU if morning mail failed.
#
#   CRON_TZ=Asia/Kolkata
#   50 9 * * * /opt/wrl/database/fast-close-app/scripts/vps-hosting/mis-email-morning-watchdog.sh \
#     >> /opt/wrl/database/fast-close-app/logs/mis-email-watchdog.log 2>&1
#
# From PC (asks SSH passphrase, installs cron line, keeps existing mis-email crons):
#   npm run mis-email:install-watchdog:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
ALERT_TO="${MIS_EMAIL_WATCHDOG_TO:-vishnu.vishwakarma@westernequipments.com}"
LOG="${INSTALL_ROOT}/logs/mis-email-cron.log"
TODAY="$(TZ=Asia/Kolkata date +%F)"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"

mkdir -p "${INSTALL_ROOT}/logs"

ok=0
reason=""

if [[ ! -f "$LOG" ]]; then
  reason="Morning MIS log missing (${LOG}). Cron may not have run or path wrong."
elif ! grep -F "$TODAY" "$LOG" >/dev/null 2>&1; then
  reason="No MIS digest log lines for today (${TODAY}). 09:30 cron likely did not run."
elif grep -E "FATAL|Cannot find module|Error:|mis-email-digest.*exit" "$LOG" \
  | grep -F "$TODAY" >/dev/null 2>&1; then
  # Fall through: also require a clean complete today
  if ! awk -v d="$TODAY" '
    $0 ~ d { day=1 }
    day && /mis-email-digest complete/ { ok=1 }
    END { exit ok ? 0 : 1 }
  ' "$LOG"; then
    reason="Morning MIS started today but did NOT finish successfully. Check ${LOG}."
  else
    ok=1
  fi
elif awk -v d="$TODAY" '
  $0 ~ d { day=1 }
  day && /mis-email-digest complete/ { ok=1 }
  END { exit ok ? 0 : 1 }
' "$LOG"; then
  ok=1
else
  reason="Morning MIS log has activity today but no 'mis-email-digest complete'. Build may still be running or crashed."
fi

# Soft check: at least one company/Netcore delivery today (best-effort).
if [[ "$ok" -eq 1 ]]; then
  if command -v journalctl >/dev/null 2>&1; then
    if ! journalctl -u postfix --since "${TODAY} 09:00:00" --no-pager 2>/dev/null \
      | grep -E 'status=sent.*(westernequipments\.com|netcore)' >/dev/null 2>&1; then
      # Don't fail hard — digest may CC only internal list; log a note.
      echo "[${STAMP}] OK digest complete; note: no Netcore/westernequipments status=sent in postfix journal yet (Exchange lag possible)."
    fi
  fi
  echo "[${STAMP}] OK — morning MIS digest completed for ${TODAY}."
  exit 0
fi

echo "[${STAMP}] FAIL — ${reason}"

body="Morning MIS Report FAILED (${TODAY}).

What non-techies need to know:
  The automated 09:30 report did not finish successfully.

Why (ops):
  ${reason}

What to do:
  1) ssh to VPS and: tail -n 80 ${LOG}
  2) Re-send: bash ${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh
  3) If that fails: npm run mis-email:diagnose:vps

This alert is from mis-email-morning-watchdog.sh — not the customer digest.
"

# Prefer mailx/sendmail via local Postfix (works to Gmail from this host).
if command -v sendmail >/dev/null 2>&1; then
  {
    echo "To: ${ALERT_TO}"
    echo "From: reports@wrl-fsm.cloud"
    echo "Subject: ALERT: Morning MIS Report FAILED ${TODAY}"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo
    echo "$body"
  } | sendmail -t
  echo "[${STAMP}] alert mailed to ${ALERT_TO}"
elif command -v mail >/dev/null 2>&1; then
  echo "$body" | mail -s "ALERT: Morning MIS Report FAILED ${TODAY}" "$ALERT_TO"
  echo "[${STAMP}] alert mailed to ${ALERT_TO}"
else
  echo "[${STAMP}] could not send alert mail (no sendmail/mail)" >&2
fi

exit 1
