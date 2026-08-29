#!/usr/bin/env bash
# Cancelled-call digest — no standalone poller.
# Production/ops probe runs from evening-ops-sequencer (16:00 IST, force→ops).
# This script remains for manual / portal test: npm run mis-email:cancelled-call-digest
#
#   npm run mis-email:install-cancelled-call-digest-cron:vps
#   → removes any leftover */15 cancelled-call-digest crontab line
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

remove_poll_cron() {
  (
    crontab -l 2>/dev/null | grep -v 'cancelled-call-digest.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
  ) | awk 'NF && !seen[$0]++' | crontab -
  echo "==> Removed cancelled-call-digest standalone cron (evening-ops covers the ops probe)"
  crontab -l | grep -E 'CRON_TZ|cancelled-call|evening-ops' || true
}

if [[ "${1:-}" == "--local" ]]; then
  remove_poll_cron
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

ssh "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
(
  crontab -l 2>/dev/null | grep -v 'cancelled-call-digest.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
) | awk 'NF && !seen[$0]++' | crontab -
echo "==> Removed cancelled-call-digest standalone cron (evening-ops covers the ops probe)"
crontab -l | grep -E 'CRON_TZ|cancelled-call|evening-ops' || true
REMOTE
