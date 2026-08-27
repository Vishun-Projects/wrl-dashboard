#!/usr/bin/env bash
# Install cancelled-call digest cron — polls every 15 min Mon–Sat IST; send time from portal.
#   npm run mis-email:install-cancelled-call-digest-cron:vps
#   bash scripts/vps-hosting/install-cancelled-call-digest-cron.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

resolve_code_root() {
  local base="${1:?}"
  if [[ -e "${base}/current/scripts/vps-hosting/cancelled-call-digest.sh" ]]; then
    echo "${base}/current"
  else
    echo "$base"
  fi
}

install_cron() {
  local base="${1}"
  local code
  code="$(resolve_code_root "$base")"
  local log_dir="${base}/shared/logs"
  [[ -d "$log_dir" ]] || log_dir="${code}/logs"
  mkdir -p "$log_dir"
  local line="*/15 * * * 1-6 ${code}/scripts/vps-hosting/cancelled-call-digest.sh >> ${log_dir}/cancelled-call-digest-cron.log 2>&1"
  (
    crontab -l 2>/dev/null | grep -v 'cancelled-call-digest.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  ) | crontab -
  echo "==> Installed cancelled-call digest cron (every 15 min Mon–Sat IST; send time from portal) code=${code}"
  crontab -l | grep -E 'CRON_TZ|cancelled-call-digest' || true
}

if [[ "${1:-}" == "--local" ]]; then
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

ssh "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
$(declare -f resolve_code_root)
$(declare -f install_cron)
install_cron "${INSTALL_BASE}"
REMOTE
