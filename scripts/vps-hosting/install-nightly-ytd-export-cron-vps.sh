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
RUN_NOW="${RUN_NOW:-1}"

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
             "${code}/scripts/vps-hosting/vps-cron-gate.sh" 2>/dev/null || true
    (
      crontab -l 2>/dev/null | grep -v 'nightly-ytd-calls-export.sh' | grep -v '^CRON_TZ=' || true
      echo "CRON_TZ=Asia/Kolkata"
      echo "0 0 * * * NIGHTLY_YTD_EXPORT_TO=${DEFAULT_TO} ${code}/scripts/vps-hosting/nightly-ytd-calls-export.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
    ) | awk 'NF && !seen[$0]++' | crontab -
    echo "==> Installed nightly YTD export cron code=${code}"
    crontab -l | grep -E 'CRON_TZ|nightly-ytd-calls-export' || true
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

echo "==> Uploading nightly YTD export script into current (strip CRLF)"
scp \
  "${ROOT}/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
  "${ROOT}/scripts/vps-hosting/midnight-calls-sync.sh" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
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
mkdir -p "$log_dir"
sed 's/\r$//' /tmp/nightly-ytd-calls-export.sh > "$code/scripts/vps-hosting/nightly-ytd-calls-export.sh"
sed 's/\r$//' /tmp/midnight-calls-sync.sh > "$code/scripts/vps-hosting/midnight-calls-sync.sh"
sed 's/\r$//' /tmp/vps-cron-gate.sh > "$code/scripts/vps-hosting/vps-cron-gate.sh"
chmod +x "$code/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
         "$code/scripts/vps-hosting/midnight-calls-sync.sh" \
         "$code/scripts/vps-hosting/vps-cron-gate.sh"
rm -f /tmp/nightly-ytd-calls-export.sh /tmp/midnight-calls-sync.sh /tmp/vps-cron-gate.sh

to="${NIGHTLY_YTD_EXPORT_TO:-${DEFAULT_TO:-vishunvishwakarma90211@gmail.com}}"
(
  crontab -l 2>/dev/null | grep -v 'nightly-ytd-calls-export.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "0 0 * * * NIGHTLY_YTD_EXPORT_TO=${to} ${code}/scripts/vps-hosting/nightly-ytd-calls-export.sh >> ${log_dir}/nightly-ytd-export-cron.log 2>&1"
) | awk 'NF && !seen[$0]++' | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|nightly-ytd-calls-export' || true
printf '==> Schedule: 00:00 Asia/Kolkata daily → %s\n' "$to"
REMOTE

if [[ "$RUN_NOW" == "1" ]]; then
  echo "==> Running nightly YTD export NOW (does not wait for cron)…"
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
NIGHTLY_YTD_EXPORT_TO='${DEFAULT_TO}' bash "\$code/scripts/vps-hosting/nightly-ytd-calls-export.sh" \
  | tee -a "\${log_dir}/nightly-ytd-export-cron.log"
REMOTE
fi

echo "Installed. Nightly YTD export → ${DEFAULT_TO} at 00:00 IST."
echo "  ssh ${VPS_HOST} 'tail -n 80 ${INSTALL_BASE}/shared/logs/nightly-ytd-export-cron.log'"
