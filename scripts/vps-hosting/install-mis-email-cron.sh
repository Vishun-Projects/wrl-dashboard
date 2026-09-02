#!/usr/bin/env bash
# Install MIS email digest cron — delegates to unified mail-scheduler (every 15 min IST).
#   npm run mis-email:install-cron:vps
#   bash scripts/vps-hosting/install-mis-email-cron.sh --local
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "${ROOT}/scripts/vps-hosting/install-mail-scheduler-cron.sh" "$@"
