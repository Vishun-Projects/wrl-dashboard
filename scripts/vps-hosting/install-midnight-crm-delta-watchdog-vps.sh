#!/usr/bin/env bash
# Install midnight CRM delta watchdog cron (00:45 IST) — mails if 00:00 job failed/missing.
#
#   npm run mis-email:install-midnight-delta-watchdog:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
ALERT_TO="${MIDNIGHT_CRM_DELTA_WATCHDOG_TO:-${NIGHTLY_YTD_EXPORT_TO:-vishunvishwakarma90211@gmail.com}}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

detected=$(ssh "$VPS_HOST" bash -s <<DETECT || true
$(vps_ssh_detect_base_script "$INSTALL_BASE")
DETECT
)
if [[ -n "$detected" ]]; then
  INSTALL_BASE="$detected"
fi
echo "==> base=${INSTALL_BASE} alert_to=${ALERT_TO}"

echo "==> Uploading midnight CRM delta watchdog scripts"
scp \
  "${ROOT}/scripts/vps-hosting/midnight-crm-delta-watchdog.sh" \
  "${ROOT}/scripts/vps-hosting/send-vps-ops-alert.ts" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${ROOT}/src/lib/vps-cron/catalog.ts" \
  "${VPS_HOST}:/tmp/"

ssh "$VPS_HOST" "INSTALL_BASE='${INSTALL_BASE}' ALERT_TO='${ALERT_TO}' bash -s" <<'REMOTE'
set -euo pipefail
base="${INSTALL_BASE:?}"
base="${base%/current}"
alert_to="${ALERT_TO:?}"
if [[ -e "${base}/current/scripts/vps-hosting/nightly-ytd-calls-export.sh" ]]; then
  code="${base}/current"
else
  code="$base"
fi
log_dir="${base}/shared/logs"
[[ -d "$log_dir" ]] || log_dir="${code}/logs"
mkdir -p "$log_dir" "$code/scripts/vps-hosting" "$code/src/lib/vps-cron"

sed 's/\r$//' /tmp/midnight-crm-delta-watchdog.sh > "$code/scripts/vps-hosting/midnight-crm-delta-watchdog.sh"
sed 's/\r$//' /tmp/send-vps-ops-alert.ts > "$code/scripts/vps-hosting/send-vps-ops-alert.ts"
sed 's/\r$//' /tmp/vps-cron-gate.sh > "$code/scripts/vps-hosting/vps-cron-gate.sh"
sed 's/\r$//' /tmp/catalog.ts > "$code/src/lib/vps-cron/catalog.ts"
chmod +x "$code/scripts/vps-hosting/midnight-crm-delta-watchdog.sh" \
         "$code/scripts/vps-hosting/vps-cron-gate.sh"
rm -f /tmp/midnight-crm-delta-watchdog.sh /tmp/send-vps-ops-alert.ts /tmp/vps-cron-gate.sh /tmp/catalog.ts

(
  crontab -l 2>/dev/null | grep -v 'midnight-crm-delta-watchdog.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "0 2 * * * MIDNIGHT_CRM_DELTA_WATCHDOG_TO=${alert_to} ${code}/scripts/vps-hosting/midnight-crm-delta-watchdog.sh >> ${log_dir}/midnight-crm-delta-watchdog.log 2>&1"
) | awk 'NF && !seen[$0]++' | crontab -

echo "==> Crontab (midnight job + watchdog):"
crontab -l | grep -E 'CRON_TZ|nightly-ytd-calls-export|midnight-crm-delta-watchdog' || true
echo "==> Watchdog: 02:00 IST daily → ${alert_to} if 00:00 job missing/failed"
REMOTE

echo "Installed. Watchdog at 02:00 IST → ${ALERT_TO}"
echo "  ssh ${VPS_HOST} 'tail -n 40 ${INSTALL_BASE}/shared/logs/midnight-crm-delta-watchdog.log'"
