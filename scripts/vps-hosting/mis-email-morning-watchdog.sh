#!/usr/bin/env bash
# Morning MIS watchdog — polite internal notice if the morning digest did not complete.
# Cron AFTER the morning digest window (default 09:50 IST Mon–Sat).
# Pause via Mail & Alerts → VPS Cron → "MIS morning watchdog" when not needed.
#
#   CRON_TZ=Asia/Kolkata
#   50 9 * * 1-6 /opt/wrl/database/fast-close-app/scripts/vps-hosting/mis-email-morning-watchdog.sh \
#     >> /opt/wrl/database/fast-close-app/logs/mis-email-watchdog.log 2>&1
#
# From PC (asks SSH passphrase, installs cron line, keeps existing mis-email crons):
#   npm run mis-email:install-watchdog:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
LOG="${INSTALL_ROOT}/logs/mis-email-cron.log"
TODAY="$(TZ=Asia/Kolkata date +%F)"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"

mkdir -p "${INSTALL_ROOT}/logs"

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
# Prefer .env.mis-email for DATABASE_URL when gating
if [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-email"
  set +a
fi
vps_cron_gate_allow mis_email_watchdog || exit 0

# Digest does not run Sundays — do not alert as a failure.
if [[ "$(TZ=Asia/Kolkata date +%u)" == "7" ]]; then
  echo "${STAMP} watchdog skipped — Sunday (IST), no morning digest expected"
  exit 0
fi

ok=0
reason=""

if [[ ! -f "$LOG" ]]; then
  reason="Morning MIS log missing (${LOG}). Cron may not have run or path wrong."
elif ! grep -F "$TODAY" "$LOG" >/dev/null 2>&1; then
  reason="No MIS digest log lines for today (${TODAY}). Digest cron likely did not run."
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

# Send via Node so subject/body/To come from Mail & Alerts org settings (DB).
# Env MIS_EMAIL_WATCHDOG_TO still overrides the org recipient.
MIS_EMAIL_WATCHDOG_DATE="${TODAY}" MIS_EMAIL_WATCHDOG_REASON="${reason}" \
  npx tsx "${INSTALL_ROOT}/scripts/vps-hosting/send-mis-email-watchdog-alert.ts"

exit 1
