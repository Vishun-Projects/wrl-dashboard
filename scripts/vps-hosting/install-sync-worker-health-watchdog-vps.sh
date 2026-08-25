#!/usr/bin/env bash
# Install sync-worker health watchdog cron (every 15 min IST).
# Cron paths use .../current so release flips do not need crontab reinstall.
#
#   npm run sync-worker:install-health-watchdog:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
ALERT_TO="${SYNC_WORKER_ALERT_TO:-vishunvishwakarma90211@gmail.com}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

detected_base=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<DETECT || true
$(vps_ssh_detect_base_script "$INSTALL_BASE")
DETECT
)
if [[ -n "$detected_base" ]]; then
  INSTALL_BASE="$detected_base"
fi
echo "==> host=${VPS_HOST} base=${INSTALL_BASE} alert_to=${ALERT_TO}"

echo "==> Uploading health watchdog scripts into current release"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/sync-worker-health-watchdog.sh" \
  "${ROOT}/scripts/vps-hosting/send-vps-ops-alert.ts" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${ROOT}/src/lib/vps-cron/catalog.ts" \
  "${VPS_HOST}:/tmp/"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
base='${INSTALL_BASE}'
alert_to='${ALERT_TO}'
if [[ -e "\${base}/current/scripts/vps-hosting/sync-worker-daemon.sh" ]]; then
  code="\${base}/current"
else
  code="\$base"
fi
log_dir="\${base}/shared/logs"
[[ -d "\$log_dir" ]] || log_dir="\${code}/logs"
mkdir -p "\$code/scripts/vps-hosting" "\$code/src/lib/vps-cron" "\$log_dir"
# Prefer not to mutate immutable release; still place scripts where cron points
mv /tmp/sync-worker-health-watchdog.sh /tmp/send-vps-ops-alert.ts /tmp/vps-cron-gate.sh "\$code/scripts/vps-hosting/"
mv /tmp/catalog.ts "\$code/src/lib/vps-cron/catalog.ts"
chmod +x "\$code/scripts/vps-hosting/sync-worker-health-watchdog.sh" \
         "\$code/scripts/vps-hosting/vps-cron-gate.sh"

echo "==> Installing cron */15 IST → \$alert_to (code=\$code)"
{
  crontab -l 2>/dev/null | grep -v 'sync-worker-health-watchdog.sh' || true
  grep -q 'CRON_TZ=Asia/Kolkata' <(crontab -l 2>/dev/null || true) || echo 'CRON_TZ=Asia/Kolkata'
  echo "*/15 * * * * SYNC_WORKER_ALERT_TO=\${alert_to} \${code}/scripts/vps-hosting/sync-worker-health-watchdog.sh >> \${log_dir}/sync-worker-health-watchdog.log 2>&1"
} | awk 'NF && !seen[\$0]++' | crontab -

echo "==> Crontab (sync-worker / CRON_TZ):"
crontab -l | grep -E 'CRON_TZ|sync-worker-health' || true

echo "==> Smoke-run"
SYNC_WORKER_ALERT_TO="\$alert_to" SYNC_WORKER_INSTALL_ROOT="\$code" \
  bash "\$code/scripts/vps-hosting/sync-worker-health-watchdog.sh" || true
REMOTE

echo ""
echo "Installed. Every 15 min IST → ${ALERT_TO} on crash-loop / stale watermark."
echo "  Prefer full deploys for code: npm run sync-worker:deploy:vps"
echo "  Log: ${INSTALL_BASE}/shared/logs/sync-worker-health-watchdog.log"
