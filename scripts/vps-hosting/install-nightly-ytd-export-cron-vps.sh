#!/usr/bin/env bash
# Install nightly YTD calls export cron — 00:00 IST daily → vishunvishwakarma90211@gmail.com
#
#   npm run mis-email:install-nightly-ytd-export-cron:vps
#   RUN_NOW=0 npm run mis-email:install-nightly-ytd-export-cron:vps   # cron only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

DEFAULT_TO="${NIGHTLY_YTD_EXPORT_TO:-vishunvishwakarma90211@gmail.com}"
RUN_NOW="${RUN_NOW:-0}"

if [[ "${1:-}" == "--local" ]]; then
  install_cron() {
    local base="${1}"
    base="${base%/current}"
    local code
    if [[ -e "${base}/current/scripts/vps-hosting/nightly-ytd-calls-export.sh" ]]; then
      code="${base}/current"
    else
      code="$base"
    fi
    local log_dir="${base}/shared/logs"
    [[ -d "$log_dir" ]] || log_dir="${code}/logs"
    mkdir -p "$log_dir"
    chmod +x "${code}/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
             "${code}/scripts/vps-hosting/midnight-calls-sync.sh" \
             "${code}/scripts/vps-hosting/midnight-crm-delta-mail.sh" \
             "${code}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh" \
             "${code}/scripts/vps-hosting/vps-cron-gate.sh" 2>/dev/null || true
    (
      crontab -l 2>/dev/null \
        | grep -v 'nightly-ytd-calls-export.sh' \
        | grep -v 'midnight-crm-delta-mail' \
        | grep -v '^CRON_TZ=' || true
      echo "CRON_TZ=Asia/Kolkata"
      echo "0 0 * * * NIGHTLY_YTD_EXPORT_TO=${DEFAULT_TO} ${code}/scripts/vps-hosting/nightly-ytd-calls-export.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
      echo "30 5 * * * NIGHTLY_YTD_EXPORT_TO=${DEFAULT_TO} ${code}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
    ) | awk 'NF && !seen[$0]++' | crontab -
    echo "==> Installed midnight sync 00:00–05:00 + mail-after-sync (fallback 05:30) code=${code}"
    crontab -l | grep -E 'CRON_TZ|nightly-ytd-calls-export|midnight-crm-delta-mail' || true
  }
  install_cron "${MIS_EMAIL_INSTALL_ROOT:-$ROOT}"
  exit 0
fi

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
echo "==> base=${INSTALL_BASE}"

echo "==> Uploading midnight sync + CRM delta mail scripts into current (strip CRLF)"
scp \
  "${ROOT}/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
  "${ROOT}/scripts/vps-hosting/midnight-calls-sync.sh" \
  "${ROOT}/scripts/vps-hosting/midnight-crm-delta-mail.sh" \
  "${ROOT}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${ROOT}/src/lib/vps-cron/catalog.ts" \
  "${VPS_HOST}:/tmp/"

ssh "$VPS_HOST" "INSTALL_BASE='${INSTALL_BASE}' DEFAULT_TO='${DEFAULT_TO}' bash -s" <<'REMOTE'
set -euo pipefail
base="${INSTALL_BASE:?}"
base="${base%/current}"
if [[ -e "${base}/current/scripts/vps-hosting/mis-email-digest.sh" ]]; then
  code="${base}/current"
else
  code="$base"
fi
log_dir="${base}/shared/logs"
[[ -d "$log_dir" ]] || log_dir="${code}/logs"
mkdir -p "$log_dir" "$code/src/lib/vps-cron"
sed 's/\r$//' /tmp/nightly-ytd-calls-export.sh > "$code/scripts/vps-hosting/nightly-ytd-calls-export.sh"
sed 's/\r$//' /tmp/midnight-calls-sync.sh > "$code/scripts/vps-hosting/midnight-calls-sync.sh"
sed 's/\r$//' /tmp/midnight-crm-delta-mail.sh > "$code/scripts/vps-hosting/midnight-crm-delta-mail.sh"
sed 's/\r$//' /tmp/midnight-crm-delta-mail-fallback.sh > "$code/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh"
sed 's/\r$//' /tmp/vps-cron-gate.sh > "$code/scripts/vps-hosting/vps-cron-gate.sh"
sed 's/\r$//' /tmp/catalog.ts > "$code/src/lib/vps-cron/catalog.ts"
chmod +x "$code/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
         "$code/scripts/vps-hosting/midnight-calls-sync.sh" \
         "$code/scripts/vps-hosting/midnight-crm-delta-mail.sh" \
         "$code/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh" \
         "$code/scripts/vps-hosting/vps-cron-gate.sh"
rm -f /tmp/nightly-ytd-calls-export.sh /tmp/midnight-calls-sync.sh /tmp/midnight-crm-delta-mail.sh \
      /tmp/midnight-crm-delta-mail-fallback.sh /tmp/vps-cron-gate.sh /tmp/catalog.ts

to="${NIGHTLY_YTD_EXPORT_TO:-${DEFAULT_TO:-vishunvishwakarma90211@gmail.com}}"
(
  crontab -l 2>/dev/null \
    | grep -v 'nightly-ytd-calls-export.sh' \
    | grep -v 'midnight-crm-delta-mail' \
    | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "0 0 * * * NIGHTLY_YTD_EXPORT_TO=${to} ${code}/scripts/vps-hosting/nightly-ytd-calls-export.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
  echo "30 5 * * * NIGHTLY_YTD_EXPORT_TO=${to} ${code}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
) | awk 'NF && !seen[$0]++' | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|nightly-ytd-calls-export|midnight-crm-delta-mail' || true
printf '==> Schedule: 00:00 overnight sync (retry until 05:00) + mail after sync; fallback mail 05:30 → %s\n' "$to"
REMOTE

if [[ "$RUN_NOW" == "1" ]]; then
  echo "==> Running midnight calls sync NOW (AS_OF=yesterday IST — never into today)…"
  ssh "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
base="${INSTALL_BASE%/current}"
if [[ -e "\${base}/current/scripts/vps-hosting/nightly-ytd-calls-export.sh" ]]; then
  code="\${base}/current"
else
  code="\${base}"
fi
log_dir="\${base}/shared/logs"
[[ -d "\$log_dir" ]] || log_dir="\${code}/logs"
# Unset any stale AS_OF so script defaults to yesterday.
NIGHTLY_YTD_EXPORT_TO='${DEFAULT_TO}' env -u MIDNIGHT_SYNC_AS_OF \
  bash "\$code/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
  | tee -a "\${log_dir}/nightly-ytd-export-cron.log"
REMOTE
fi

echo "Installed. Overnight sync 00:00–05:00 IST + mail after sync (fallback 05:30) → ${DEFAULT_TO}."
echo "  ssh ${VPS_HOST} 'tail -n 80 ${INSTALL_BASE}/shared/logs/nightly-ytd-export-cron.log'"
echo "  Daytime smoke: RUN_NOW=1 npm run mis-email:install-nightly-ytd-export-cron:vps"
