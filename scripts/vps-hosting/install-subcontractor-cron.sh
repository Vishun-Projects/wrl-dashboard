#!/usr/bin/env bash
# Install subcontractor stock cron — delegates to unified mail-scheduler (every 15 min IST).
#   npm run subcontractor-stock:install-cron:vps
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "${ROOT}/scripts/vps-hosting/install-mail-scheduler-cron.sh" "$@"
