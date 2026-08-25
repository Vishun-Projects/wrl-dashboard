#!/usr/bin/env bash
# Install MIS email digest cron — every 15 min Mon–Sat IST on VPS (no Sunday).
# Paths use .../current so releases flip without reinstalling cron.
#   npm run mis-email:install-cron:vps
#   bash scripts/vps-hosting/install-mis-email-cron.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

resolve_code_root() {
  local base="${1:?}"
  if [[ -e "${base}/current/scripts/vps-hosting/mis-email-digest.sh" ]]; then
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
  local line="*/15 * * * 1-6 ${code}/scripts/vps-hosting/mis-email-digest.sh >> ${log_dir}/mis-email-cron.log 2>&1"
  (
    crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  ) | crontab -
  echo "==> Installed MIS email cron (every 15 min Mon–Sat IST) code=${code}"
  crontab -l | grep -E 'CRON_TZ|mis-email' || true
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
echo "==> base=${INSTALL_BASE}"

ssh "$VPS_HOST" "INSTALL_BASE='${INSTALL_BASE}' bash -s" <<'REMOTE'
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
(
  crontab -l 2>/dev/null | grep -v 'mis-email-digest.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "*/15 * * * 1-6 ${code}/scripts/vps-hosting/mis-email-digest.sh >> ${log_dir}/mis-email-cron.log 2>&1"
) | crontab -
echo "==> Installed MIS email cron at code=${code}"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
REMOTE
