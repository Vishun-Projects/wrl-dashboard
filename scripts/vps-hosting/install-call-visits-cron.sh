#!/usr/bin/env bash
# Install every-2-hours IST cron for the call-visits sync.
#   npm run call-visits:install-cron:vps
#   bash scripts/vps-hosting/install-call-visits-cron.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/wrl/database/fast-close-app}"

rewrite_crontab() {
  local root="${1}"
  local code="${root}"
  local log_dir="${root}/logs"
  if [[ -e "${root}/current/scripts/vps-hosting/call-visits-sync.sh" ]]; then
    code="${root}/current"
    log_dir="${root}/shared/logs"
  fi
  mkdir -p "${log_dir}"
  chmod +x "${code}/scripts/vps-hosting/call-visits-sync.sh" 2>/dev/null || true
  local line="0 */2 * * * ${code}/scripts/vps-hosting/call-visits-sync.sh >> ${log_dir}/call-visits-sync.log 2>&1"
  {
    crontab -l 2>/dev/null | grep -v 'call-visits-sync.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  } | crontab -
  echo "==> Installed call-visits sync cron (every 2 hours IST) at ${root}"
  crontab -l | grep -E 'CRON_TZ|call-visits-sync' || true
}

if [[ "${1:-}" == "--local" ]]; then
  rewrite_crontab "${MIS_EMAIL_INSTALL_ROOT:-$ROOT}"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/logs'"
scp \
  "${ROOT}/scripts/vps-hosting/call-visits-sync.sh" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"

ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<'REMOTE'
set -euo pipefail
root="${INSTALL_ROOT:-/opt/wrl/database/fast-close-app}"
if [[ -e "${root}/current/scripts/vps-hosting/call-visits-sync.sh" ]]; then
  code="${root}/current"
  log_dir="${root}/shared/logs"
else
  code="${root}"
  log_dir="${root}/logs"
fi
mkdir -p "${log_dir}"
chmod +x "${code}/scripts/vps-hosting/call-visits-sync.sh"
line="0 */2 * * * ${code}/scripts/vps-hosting/call-visits-sync.sh >> ${log_dir}/call-visits-sync.log 2>&1"
{
  crontab -l 2>/dev/null | grep -v 'call-visits-sync.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "$line"
} | crontab -
echo "==> Installed call-visits sync cron (every 2 hours IST) at ${root}"
crontab -l | grep -E 'CRON_TZ|call-visits-sync' || true
REMOTE
