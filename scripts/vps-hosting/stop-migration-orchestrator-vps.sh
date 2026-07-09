#!/usr/bin/env bash
# Stop WRL Migration progress-report emails from VPS (migration-orchestrator daemon).
#   bash scripts/vps-hosting/stop-migration-orchestrator-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

ssh "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
if systemctl is-active wrl-migration-orchestrator.service >/dev/null 2>&1; then
  systemctl stop wrl-migration-orchestrator.service
  echo "==> Stopped wrl-migration-orchestrator.service"
fi
systemctl disable wrl-migration-orchestrator.service 2>/dev/null || true
echo "==> Disabled wrl-migration-orchestrator.service (no longer starts on boot)"
if [[ -f /opt/wrl/.env ]]; then
  if grep -q '^MIGRATION_REPORT_DRY_RUN=' /opt/wrl/.env; then
    sed -i 's/^MIGRATION_REPORT_DRY_RUN=.*/MIGRATION_REPORT_DRY_RUN=1/' /opt/wrl/.env
  else
    echo 'MIGRATION_REPORT_DRY_RUN=1' >> /opt/wrl/.env
  fi
  echo "==> Set MIGRATION_REPORT_DRY_RUN=1 in /opt/wrl/.env"
fi
systemctl is-active wrl-migration-orchestrator.service || echo "==> Service is inactive (OK)"
REMOTE

echo "==> WRL Migration orchestrator stopped on VPS."
