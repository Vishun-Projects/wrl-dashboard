#!/usr/bin/env bash
# MIS email digest scheduler — run via cron every 15 min Mon–Sat IST (no Sunday).
# Who/when to send is decided in the portal (prefs + routing); this only polls.
#
# Morning open mail is gated on last night's midnight verify marker so we do not
# ship Open Excel from stale hot after CRM 405 / incomplete catch-up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

# Belt-and-suspenders if cron still has * * * (0=Sun in cron, %u=7 is Sunday).
if [[ "$(TZ=Asia/Kolkata date +%u)" == "7" ]]; then
  echo "=== mis-email-digest skipped — Sunday (IST) ==="
  exit 0
fi

LOCK_FILE="${INSTALL_ROOT}/logs/mis-email.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== mis-email-digest skipped — already running (pid ${lock_pid}) ==="
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
elif [[ -f "${INSTALL_ROOT}/shared/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/shared/.env.mis-email"
  set +a
else
  # Release layout: code in current/, env in shared/
  BASE_FOR_ENV="${INSTALL_ROOT%/current}"
  if [[ -f "${BASE_FOR_ENV}/shared/.env.mis-email" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${BASE_FOR_ENV}/shared/.env.mis-email"
    set +a
  else
    echo "FATAL: missing .env.mis-email under ${INSTALL_ROOT}" >&2
    exit 1
  fi
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
# USE_DIRECT_DATABASE comes from .env.mis-email (false for VPS pooler)

echo "=== mis-email-digest $(date -Iseconds) TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow mis_email_digest || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

# --- shared logs (release: /opt/…/fast-close-app/shared/logs) ---
BASE_ROOT="${INSTALL_ROOT%/current}"
LOG_DIR="${BASE_ROOT}/shared/logs"
if [[ ! -d "$LOG_DIR" ]]; then
  LOG_DIR="${INSTALL_ROOT}/shared/logs"
fi
if [[ ! -d "$LOG_DIR" ]]; then
  LOG_DIR="${INSTALL_ROOT}/logs"
fi
mkdir -p "$LOG_DIR"

# Yesterday IST = midnight AS_OF / MIS "year to yesterday"
if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
  AS_OF="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
else
  AS_OF="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
fi
VERIFY_OK="${LOG_DIR}/midnight-crm-verify-ok-${AS_OF}"
EDITEDON_FAIL="${LOG_DIR}/editedon-catchup-failed-${AS_OF}"
ALERT_TO="${MIS_EMAIL_STALE_HOT_ALERT_TO:-${SYNC_WORKER_ALERT_TO:-${MIS_EMAIL_WATCHDOG_TO:-vishunvishwakarma90211@gmail.com}}}"
# Always CC personal gmail so 405 / blocked-MIS alerts are actionable for manual /admin/sync.
case ",${ALERT_TO}," in
  *,vishunvishwakarma90211@gmail.com,*) ;;
  *) ALERT_TO="${ALERT_TO},vishunvishwakarma90211@gmail.com" ;;
esac
REQUIRE_VERIFY="${MIS_EMAIL_REQUIRE_MIDNIGHT_VERIFY:-true}"
ALERT_SENT_FLAG="${LOG_DIR}/mis-email-blocked-alerted-${AS_OF}"

send_ops_alert() {
  local subject=$1
  local body=$2
  if [[ -f "$ALERT_SENT_FLAG" ]]; then
    echo "→ ops alert already sent for AS_OF=${AS_OF} — skip duplicate"
    return 0
  fi
  if [[ ! -f "${SCRIPT_DIR}/send-vps-ops-alert.ts" ]]; then
    echo "WARN: send-vps-ops-alert.ts missing — ${subject}" >&2
    return 0
  fi
  if VPS_OPS_ALERT_TO="${ALERT_TO}" \
    VPS_OPS_ALERT_SUBJECT="${subject}" \
    VPS_OPS_ALERT_BODY="${body}" \
    npx tsx "${SCRIPT_DIR}/send-vps-ops-alert.ts"; then
    echo "${AS_OF}" >"$ALERT_SENT_FLAG"
  else
    echo "WARN: ops alert mail failed" >&2
  fi
}

PORTAL_SYNC_URL="${MIS_EMAIL_PORTAL_URL:-https://wrl-dashboard.vercel.app}"
PORTAL_SYNC_URL="${PORTAL_SYNC_URL%/}/admin/sync"

# Gate: do not auto-send MIS when last night's hot verify never passed.
if [[ "${REQUIRE_VERIFY}" != "false" ]]; then
  if [[ ! -f "$VERIFY_OK" ]]; then
    reason="Missing midnight verify marker ${VERIFY_OK} (AS_OF=${AS_OF}). Hot may be stale after CRM 405 / incomplete catch-up — MIS open mail blocked."
    if [[ -f "$EDITEDON_FAIL" ]]; then
      reason="${reason} Editedon catch-up also left failed days marker: ${EDITEDON_FAIL}"
    fi
    echo "=== mis-email-digest SKIP — ${reason} ===" >&2
    send_ops_alert \
      "[WRL] Morning MIS blocked — no midnight verify for ${AS_OF}" \
      "${reason}

Open Sync UI and re-run catch-up / verify when CRM is healthy:
  ${PORTAL_SYNC_URL}

Or wait for tonight's midnight sync (retries until 07:00 IST).
Override (not recommended): MIS_EMAIL_REQUIRE_MIDNIGHT_VERIFY=false
Time: $(TZ=Asia/Kolkata date -Iseconds)"
    exit 0
  fi
  if [[ -f "$EDITEDON_FAIL" ]]; then
    reason="Editedon catch-up failed days still marked at ${EDITEDON_FAIL} (AS_OF=${AS_OF}). MIS open mail blocked until catch-up completes cleanly."
    echo "=== mis-email-digest SKIP — ${reason} ===" >&2
    send_ops_alert \
      "[WRL] Morning MIS blocked — editedon catch-up incomplete for ${AS_OF}" \
      "${reason}

Failed days:
$(cat "$EDITEDON_FAIL" 2>/dev/null || true)

Open Sync UI: ${PORTAL_SYNC_URL}
Time: $(TZ=Asia/Kolkata date -Iseconds)"
    exit 0
  fi
fi

# Pre-mail: refresh any open/assigned hot rows CRM already cancelled.
# Only in the morning send window — */15 polls must not hammer CRM all day.
HOUR_MIN="$(TZ=Asia/Kolkata date +%H%M)"
if (( 10#${HOUR_MIN} >= 800 && 10#${HOUR_MIN} <= 1200 )); then
  echo "→ pre-mail reconcile-open-cancel (morning window ${HOUR_MIN} IST)"
  if ! npm run sync-worker:reconcile-open-cancel; then
    reason="reconcile-open-cancel failed before MIS digest — refusing to send open mail on possibly stale cancels."
    echo "FATAL: ${reason}" >&2
    send_ops_alert \
      "[WRL] Morning MIS blocked — open-cancel reconcile failed" \
      "${reason}

AS_OF=${AS_OF}
Time: $(TZ=Asia/Kolkata date -Iseconds)"
    exit 1
  fi
else
  echo "→ skip pre-mail reconcile-open-cancel (outside 08:00–12:00 IST)"
fi

npm run mis-email:digest
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: mis-email digest exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== mis-email-digest complete ==="
