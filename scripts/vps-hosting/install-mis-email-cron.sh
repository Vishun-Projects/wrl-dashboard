#!/usr/bin/env bash
# Install MIS email digest cron — once daily at 09:30 IST on VPS.
#   npm run mis-email:install-cron:vps
#   bash scripts/vps-hosting/install-mis-email-cron.sh --local   # on the VPS itself
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
# Once per day at 09:30 Asia/Kolkata (matches default / profile sendTimeIst).
CRON_LINE="30 9 * * * ${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh >> ${INSTALL_ROOT}/logs/mis-email-cron.log 2>&1"

install_cron() {
  local root="${1}"
  local line="30 9 * * * ${root}/scripts/vps-hosting/mis-email-digest.sh >> ${root}/logs/mis-email-cron.log 2>&1"
  (
    crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  ) | crontab -
  echo "==> Installed MIS email cron (once daily 09:30 IST)"
  crontab -l | grep -E 'CRON_TZ|mis-email' || true
}

if [[ "${1:-}" == "--local" ]]; then
  install_cron "${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<'REMOTE'
set -euo pipefail
root="${INSTALL_ROOT:-/opt/fast-close-app}"
(
  crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "30 9 * * * ${root}/scripts/vps-hosting/mis-email-digest.sh >> ${root}/logs/mis-email-cron.log 2>&1"
) | crontab -
echo "==> Installed MIS email cron (once daily 09:30 IST)"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
REMOTE
