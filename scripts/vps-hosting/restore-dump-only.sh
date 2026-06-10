#!/usr/bin/env bash
# Restore-only: use existing /root/supabase_cloud.dump (skip cloud pg_dump).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
# shellcheck disable=SC1090
source "$ENV_FILE"
export SKIP_DUMP=true
CLOUD_DB_PASSWORD="${CLOUD_DB_PASSWORD}" \
VPS_HOST="${VPS_HOST}" \
ANON_KEY="${ANON_KEY}" \
bash "${ROOT}/scripts/vps-hosting/migrate-db-from-cloud.sh"
