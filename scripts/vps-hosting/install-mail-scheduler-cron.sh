#!/usr/bin/env bash
# Install unified mail scheduler cron — every 15 min daily IST.
# Replaces separate mis-email-digest.sh + subcontractor-stock-cron.sh crontab lines.
#
#   bash scripts/vps-hosting/install-mail-scheduler-cron.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

install_cron() {
  local base="${1}"
  base="${base%/current}"
  local code=""
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    if [[ ! -e "${base}/current/scripts/vps-hosting/mail-scheduler.sh" ]]; then
      echo "ERROR: ${base}/current exists but mail-scheduler.sh is missing — deploy first" >&2
      exit 1
    fi
    code="${base}/current"
  elif [[ -e "${base}/scripts/vps-hosting/mail-scheduler.sh" ]]; then
    code="$base"
  else
    echo "ERROR: mail-scheduler.sh not found under ${base} or ${base}/current" >&2
    exit 1
  fi
  local log_dir="${base}/shared/logs"
  [[ -d "$log_dir" ]] || log_dir="${code}/logs"
  mkdir -p "$log_dir"
  local line="*/15 * * * * ${code}/scripts/vps-hosting/mail-scheduler.sh >> ${log_dir}/mail-scheduler.log 2>&1"
  (
    crontab -l 2>/dev/null \
      | grep -v 'mis-email-digest.sh' \
      | grep -v 'subcontractor-stock-cron.sh' \
      | grep -v 'mail-scheduler.sh' \
      | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  ) | crontab -
  echo "==> Installed mail scheduler cron (every 15 min IST) code=${code}"
  crontab -l | grep -E 'CRON_TZ|mail-scheduler' || true
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
code=""
if [[ -L "${base}/current" || -d "${base}/current" ]]; then
  if [[ ! -e "${base}/current/scripts/vps-hosting/mail-scheduler.sh" ]]; then
    echo "ERROR: ${base}/current exists but mail-scheduler.sh is missing — deploy first" >&2
    exit 1
  fi
  code="${base}/current"
elif [[ -e "${base}/scripts/vps-hosting/mail-scheduler.sh" ]]; then
  code="$base"
else
  echo "ERROR: mail-scheduler.sh not found under ${base} or ${base}/current" >&2
  exit 1
fi
log_dir="${base}/shared/logs"
[[ -d "$log_dir" ]] || log_dir="${code}/logs"
mkdir -p "$log_dir"
(
  crontab -l 2>/dev/null \
    | grep -v 'mis-email-digest.sh' \
    | grep -v 'subcontractor-stock-cron.sh' \
    | grep -v 'mail-scheduler.sh' \
    | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "*/15 * * * * ${code}/scripts/vps-hosting/mail-scheduler.sh >> ${log_dir}/mail-scheduler.log 2>&1"
) | crontab -
echo "==> Installed mail scheduler cron at code=${code}"
crontab -l | grep -E 'CRON_TZ|mail-scheduler' || true
REMOTE
