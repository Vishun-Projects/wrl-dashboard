#!/usr/bin/env bash
# Install daily MIS email digest cron (7 AM IST) on VPS.
#   npm run mis-email:install-cron:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
CRON_LINE="0 7 * * * ${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh >> ${INSTALL_ROOT}/logs/mis-email-cron.log 2>&1"

if [[ "${1:-}" == "--local" ]]; then
  INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
  CRON_LINE="0 7 * * * ${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh >> ${INSTALL_ROOT}/logs/mis-email-cron.log 2>&1"
  (crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' || true
   echo "CRON_TZ=Asia/Kolkata"
   echo "$CRON_LINE") | crontab -
  echo "==> Installed MIS email cron (7 AM IST)"
  crontab -l | grep -E 'CRON_TZ|mis-email' || true
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
line="0 7 * * * ${root}/scripts/vps-hosting/mis-email-digest.sh >> ${root}/logs/mis-email-cron.log 2>&1"
(crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' || true
 echo "CRON_TZ=Asia/Kolkata"
 echo "$line") | crontab -
echo "==> MIS email cron installed (7 AM IST)"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
REMOTE
