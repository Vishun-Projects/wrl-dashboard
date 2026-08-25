#!/usr/bin/env bash
# Sync-worker health watchdog — email if daemon crash-loops or watermark goes stale.
# Rate-limited: one mail per failure fingerprint; one recovery mail when healthy again.
#
#   CRON_TZ=Asia/Kolkata
#   */15 * * * * SYNC_WORKER_ALERT_TO=… /opt/wrl/database/fast-close-app/scripts/vps-hosting/sync-worker-health-watchdog.sh \
#     >> /opt/wrl/database/fast-close-app/logs/sync-worker-health-watchdog.log 2>&1
#
# Pause via Mail & Alerts → VPS Cron → "Sync worker health watchdog"
#   npm run sync-worker:install-health-watchdog:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
STAMP="$(TZ=Asia/Kolkata date -Iseconds)"
TODAY="$(TZ=Asia/Kolkata date +%F)"
STATE_FILE="${INSTALL_ROOT}/logs/sync-worker-health.state"
STALE_HOURS="${SYNC_WORKER_STALE_HOURS:-2}"
ALERT_TO="${SYNC_WORKER_ALERT_TO:-vishunvishwakarma90211@gmail.com}"
UNIT="fast-close-sync-worker"

mkdir -p "${INSTALL_ROOT}/logs"

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
for envf in "${INSTALL_ROOT}/.env.sync-worker" "${INSTALL_ROOT}/.env.mis-email"; do
  if [[ -f "$envf" ]]; then
    set -a
    # shellcheck disable=SC1090
    source <(sed 's/\r$//' "$envf")
    set +a
  fi
done
vps_cron_gate_allow sync_worker_health || exit 0

send_alert() {
  local subject="$1"
  local body="$2"
  VPS_OPS_ALERT_TO="${ALERT_TO}" \
    VPS_OPS_ALERT_SUBJECT="${subject}" \
    VPS_OPS_ALERT_BODY="${body}" \
    npx tsx "${INSTALL_ROOT}/scripts/vps-hosting/send-vps-ops-alert.ts"
}

read_state() {
  STATUS_WAS="ok"
  FINGERPRINT_WAS=""
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" || true
    STATUS_WAS="${status:-ok}"
    FINGERPRINT_WAS="${fingerprint:-}"
  fi
}

write_state() {
  local status="$1"
  local fingerprint="$2"
  cat >"$STATE_FILE" <<EOF
status=${status}
fingerprint=${fingerprint}
updated_at=${STAMP}
EOF
}

# --- collect signals ---
reasons=()
active="$(systemctl is-active "$UNIT" 2>/dev/null || echo unknown)"
active_state="$(systemctl show "$UNIT" -p ActiveState --value 2>/dev/null || echo unknown)"
sub_state="$(systemctl show "$UNIT" -p SubState --value 2>/dev/null || echo unknown)"
nrestarts="$(systemctl show "$UNIT" -p NRestarts --value 2>/dev/null || echo 0)"
result="$(systemctl show "$UNIT" -p Result --value 2>/dev/null || echo unknown)"

if [[ "$active" != "active" ]]; then
  reasons+=("The background sync service is not running normally (status: ${active}).")
fi
if [[ "$active_state" == "activating" && "$sub_state" == "auto-restart" ]]; then
  reasons+=("The sync service keeps crashing and restarting over and over.")
fi

# Watermark / last_run from sync_state (optional — skip if DB unreachable)
last_editedon=""
last_run_at=""
sync_status=""
watermark_line=""
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^supabase-db$'; then
  watermark_line="$(
    docker exec supabase-db psql -U postgres postgres -At -c \
      "SELECT coalesce(last_editedon::text,'null') || '|' || coalesce(last_run_at::text,'null') || '|' || coalesce(status,'')
       FROM sync_state WHERE entity = 'calls_latest_hot' LIMIT 1;" 2>/dev/null || true
  )"
fi

if [[ -n "$watermark_line" ]]; then
  IFS='|' read -r last_editedon last_run_at sync_status <<<"$watermark_line"
  if [[ -n "$last_editedon" && "$last_editedon" != "null" ]]; then
    # Compare age in seconds via date -d (GNU)
    edited_epoch="$(date -d "$last_editedon" +%s 2>/dev/null || echo 0)"
    now_epoch="$(date +%s)"
    age_h=$(( (now_epoch - edited_epoch) / 3600 ))
    if [[ "$edited_epoch" -gt 0 && "$age_h" -ge "$STALE_HOURS" ]]; then
      reasons+=("Call data on the server has not updated for about ${age_h} hours (we expect updates within ${STALE_HOURS} hours). Last successful sync time: ${last_editedon}.")
    fi
  fi
fi

log_tail=""
if [[ -f "${INSTALL_ROOT}/logs/sync-worker.log" ]]; then
  log_tail="$(tail -n 20 "${INSTALL_ROOT}/logs/sync-worker.log" 2>/dev/null || true)"
fi

read_state

if [[ "${#reasons[@]}" -eq 0 ]]; then
  echo "[${STAMP}] OK — ${UNIT} active=${active} NRestarts=${nrestarts} watermark=${last_editedon:-n/a}"
  if [[ "$STATUS_WAS" == "fail" ]]; then
    body="Good news — the call sync service is healthy again.

Checked at: ${STAMP} (India time)
Date: ${TODAY}

What this means for you:
  • Morning MIS and dashboard call counts should start reflecting CRM changes again.
  • No action needed unless another alert arrives.

Last time call data was synced: ${last_editedon:-unknown}
"
    send_alert "Call sync is working again — ${TODAY}" "$body" || echo "WARN: recovery mail failed"
    write_state "ok" ""
  else
    write_state "ok" ""
  fi
  exit 0
fi

reason_text="$(printf '%s\n' "${reasons[@]}")"
# Fingerprint = first reason line (stable category) + module-not-found snippet if present
fp_extra=""
if echo "$log_tail" | grep -q 'Cannot find module'; then
  fp_extra="$(echo "$log_tail" | grep 'Cannot find module' | head -1 | tr -cd '[:alnum:]@/_.:-' | head -c 120)"
fi
fingerprint="$(echo "${reasons[0]}|${fp_extra}" | tr -cd '[:alnum:]|_=.-' | head -c 160)"

echo "[${STAMP}] FAIL — ${reason_text}"

if [[ "$STATUS_WAS" == "fail" && "$FINGERPRINT_WAS" == "$fingerprint" ]]; then
  echo "[${STAMP}] alert suppressed (same fingerprint)"
  write_state "fail" "$fingerprint"
  exit 1
fi

body="Hello,

The automatic check on the server found a problem with call syncing.

Checked at: ${STAMP} (India time)

What went wrong:
${reason_text}

What this means if it stays broken:
  • Morning MIS numbers and open-call counts can fall behind what is in CRM.
  • Register / dashboard reports may look outdated until sync is fixed.

What to do next:
  1. Ask whoever last pushed code to the VPS to redeploy the sync worker (or check with IT).
  2. From your PC you can run: npm run sync-worker:status:vps
  3. If a deploy was incomplete, run: npm run sync-worker:deploy:vps

You will get another mail when this is fixed.

— WRL server monitoring
"

send_alert "Call sync needs attention — ${TODAY}" "$body"
write_state "fail" "$fingerprint"
exit 1
