#!/usr/bin/env bash
# Midnight CRM delta watchdog — alert if 00:00 sync / 00:15 report did not complete.
# Runs twice: 00:30 IST (early catch after mail) + 02:00 IST (after long sync window).
#
#   CRON_TZ=Asia/Kolkata
#   30 0 * * * …/midnight-crm-delta-watchdog.sh >> …/midnight-crm-delta-watchdog.log
#   0 2 * * * …/midnight-crm-delta-watchdog.sh >> …/midnight-crm-delta-watchdog.log
#
#   npm run mis-email:install-midnight-delta-watchdog:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"

# Prefer shared logs (release layout)
LOG="${INSTALL_ROOT}/shared/logs/nightly-ytd-export-cron.log"
if [[ ! -f "$LOG" ]]; then
  LOG="${INSTALL_ROOT}/logs/nightly-ytd-export-cron.log"
fi
if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
  CODE="${INSTALL_ROOT}/current"
else
  CODE="$INSTALL_ROOT"
fi

TODAY="$(TZ=Asia/Kolkata date +%F)"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"
ALERT_TO="${MIDNIGHT_CRM_DELTA_WATCHDOG_TO:-${NIGHTLY_YTD_EXPORT_TO:-${MIDNIGHT_CRM_DELTA_TO:-vishunvishwakarma90211@gmail.com}}}"

mkdir -p "${INSTALL_ROOT}/shared/logs" "${INSTALL_ROOT}/logs" 2>/dev/null || true

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
if [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-email"
  set +a
elif [[ -f "${CODE}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${CODE}/.env.mis-email"
  set +a
fi
vps_cron_gate_allow midnight_crm_delta_watchdog || exit 0

# If the midnight sync is still running, wait — do not false-alarm (esp. at 00:30).
LOCK="${INSTALL_ROOT}/logs/midnight-crm-delta.lock"
if [[ ! -f "$LOCK" && -f "${INSTALL_ROOT}/shared/logs/midnight-crm-delta.lock" ]]; then
  LOCK="${INSTALL_ROOT}/shared/logs/midnight-crm-delta.lock"
fi
# Also check under current release cwd logs
if [[ ! -f "$LOCK" && -f "${CODE}/logs/midnight-crm-delta.lock" ]]; then
  LOCK="${CODE}/logs/midnight-crm-delta.lock"
fi
if [[ -f "$LOCK" ]]; then
  lock_pid=$(cat "$LOCK" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "[${STAMP}] SKIP — midnight sync still running (pid ${lock_pid}). 00:15 mail may still have been sent; will re-check at 02:00."
    exit 0
  fi
fi

ok=0
reason=""

if [[ ! -f "$LOG" ]]; then
  reason="Midnight CRM delta log missing (${LOG}). Cron may not be installed or path wrong."
elif ! grep -F "$TODAY" "$LOG" >/dev/null 2>&1; then
  reason="No midnight CRM delta log lines for today (${TODAY}). 00:00/00:15 jobs likely did not run."
elif grep -E "FATAL: midnight calls sync failed|FATAL: midnight CRM delta" "$LOG" \
  | grep -F "$TODAY" >/dev/null 2>&1; then
  # Mail is always-send at 00:15 — sync FATAL alone is not enough if complete exists.
  if awk -v d="$TODAY" '
    $0 ~ d { day=1 }
    day && /midnight-crm-delta complete/ { ok=1 }
    END { exit ok ? 0 : 1 }
  ' "$LOG"; then
    ok=1
  else
    reason="Midnight job logged FATAL for ${TODAY} and no 'midnight-crm-delta complete'. Check ${LOG}."
  fi
elif awk -v d="$TODAY" '
  $0 ~ d { day=1 }
  day && /midnight-crm-delta complete/ { ok=1 }
  END { exit ok ? 0 : 1 }
' "$LOG"; then
  ok=1
else
  if awk -v d="$TODAY" '
    $0 ~ d { day=1 }
    day && /midnight-crm-delta / { started=1 }
    day && /midnight calls sync/ { started=1 }
    END { exit started ? 0 : 1 }
  ' "$LOG"; then
    reason="Midnight job started today but no 'midnight-crm-delta complete' (00:15 mail missing). Check ${LOG}."
  else
    reason="Midnight log has ${TODAY} activity but no clear start/complete. Check ${LOG}."
  fi
fi

if [[ "$ok" -eq 1 ]]; then
  echo "[${STAMP}] OK — midnight CRM delta mail completed for ${TODAY} (00:15 complete marker)."
  exit 0
fi

echo "[${STAMP}] FAIL — ${reason}"

cd "$CODE"
export VPS_OPS_ALERT_TO="$ALERT_TO"
export VPS_OPS_ALERT_SUBJECT="ALERT: Midnight CRM sync/report missing — ${TODAY}"
export VPS_OPS_ALERT_BODY="Midnight calls sync + CRM delta did not complete successfully.

Date (IST): ${TODAY}
Checked at: ${STAMP}
Reason: ${reason}

Log: ${LOG}

Expected:
  00:00 IST — nightly-ytd-calls-export.sh (sync only)
  00:15 IST — midnight-crm-delta-mail.sh (always mail + complete marker)
Watchdog: this script at 00:30 and 02:00 IST (alert only if broken)

Manual check:
  tail -n 200 ${LOG}
"

npx tsx "${CODE}/scripts/vps-hosting/send-vps-ops-alert.ts"
exit 1
