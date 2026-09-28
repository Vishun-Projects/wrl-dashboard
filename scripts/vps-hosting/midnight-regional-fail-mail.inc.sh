# Sourced by nightly-ytd-calls-export.sh and midnight-crm-delta-mail-fallback.sh.
# Sends FAILED subject: "FAILED: WRL Midnight MIS Regional — {asOf}".
send_midnight_regional_fail_mail() {
  local reason=$1
  local as_of="${AS_OF:-unknown}"
  local marker="${INSTALL_ROOT}/shared/logs/midnight-regional-fail-mailed-${as_of}"
  if [[ -f "$marker" ]]; then
    echo "→ FAIL mail already sent for AS_OF=${as_of}"
    FAIL_ALERTED=1
    return 0
  fi
  local to="${NIGHTLY_YTD_EXPORT_TO:-${MIDNIGHT_CRM_DELTA_TO:-vishunvishwakarma90211@gmail.com}}"
  case ",${to}," in
    *,vishnu.vishwakarma@westernequipments.com,*) ;;
    *) to="${to},vishnu.vishwakarma@westernequipments.com" ;;
  esac
  local verify_line=""
  local log="${INSTALL_ROOT}/shared/logs/nightly-ytd-export-cron.log"
  if [[ -f "$log" ]]; then
    verify_line="$(grep -F '[midnight-verify]' "$log" | tail -1 || true)"
  fi
  local subject="FAILED: WRL Midnight MIS Regional — ${as_of}"
  local body="FAILED — WRL Midnight MIS Regional did not send.

AS_OF: ${as_of}
Time: $(TZ=Asia/Kolkata date -Iseconds)
Reason: ${reason}

Morning 09:30 company MIS will stay blocked (no verify marker).
"
  if [[ -n "$verify_line" ]]; then
    body+="Last verify: ${verify_line}
"
  fi
  body+="Log: ${log}
Portal: https://wrl-dashboard.vercel.app/admin/sync

Ramp-up: run catch-up/verify on Sync UI, then send 09:30 from Mail & Alerts if needed."
  if [[ ! -f "${SCRIPT_DIR}/send-vps-ops-alert.ts" ]]; then
    echo "WARN: send-vps-ops-alert.ts missing — ${subject}" >&2
    return 0
  fi
  if [[ -f "${INSTALL_ROOT}/shared/.env.mis-email" ]]; then
    set -a
    # shellcheck disable=SC1091
    source <(sed 's/\r$//' "${INSTALL_ROOT}/shared/.env.mis-email")
    set +a
  fi
  local code="$INSTALL_ROOT"
  if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
    code="${INSTALL_ROOT}/current"
  fi
  if (
    cd "$code"
    export VPS_OPS_ALERT_TO="$to"
    export VPS_OPS_ALERT_SUBJECT="$subject"
    export VPS_OPS_ALERT_BODY="$body"
    npx tsx "${SCRIPT_DIR}/send-vps-ops-alert.ts"
  ); then
    mkdir -p "$(dirname "$marker")"
    echo "${as_of}" >"$marker"
    FAIL_ALERTED=1
  else
    echo "WARN: midnight FAIL mail send failed" >&2
  fi
}
