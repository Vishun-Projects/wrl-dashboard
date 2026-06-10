#!/usr/bin/env bash
# Dump Supabase cloud Postgres and restore into self-hosted VPS stack.
# pg_dump + pg_restore both use Docker postgres:17 (matches Supabase cloud 17.6).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE_SCRIPT="${ROOT}/scripts/vps-hosting/restore-on-vps.sh"
ENV_FILE="${ROOT}/.env.vps-setup"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

PROJECT_REF="${PROJECT_REF:-ddmapuyghfeoyajxbcjh}"
CLOUD_DIRECT_HOST="${CLOUD_DIRECT_HOST:-db.${PROJECT_REF}.supabase.co}"
CLOUD_POOLER_HOST="${CLOUD_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}"
VPS_HOST="${VPS_HOST:-root@187.127.145.253}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"
API_DOMAIN="${API_DOMAIN:-api.wrl-fsm.cloud}"
SKIP_DUMP="${SKIP_DUMP:-false}"

if [[ -z "${CLOUD_DB_PASSWORD:-}" ]]; then
  echo "Set CLOUD_DB_PASSWORD (Supabase database password)" >&2
  exit 1
fi

echo "==> Copying restore script to VPS"
scp "$REMOTE_SCRIPT" "${VPS_HOST}:/root/restore-on-vps.sh"

echo "==> Running dump + restore on VPS (via SSH)"
if ! ssh "$VPS_HOST" \
  CLOUD_DB_PASSWORD="${CLOUD_DB_PASSWORD}" \
  SUPABASE_DIR="${SUPABASE_DIR}" \
  API_DOMAIN="${API_DOMAIN}" \
  ANON_KEY="${ANON_KEY:-}" \
  SKIP_DUMP="${SKIP_DUMP}" \
  PROJECT_REF="${PROJECT_REF}" \
  CLOUD_DIRECT_HOST="${CLOUD_DIRECT_HOST}" \
  CLOUD_POOLER_HOST="${CLOUD_POOLER_HOST}" \
  bash /root/restore-on-vps.sh; then
  echo "ERROR: VPS restore failed — see output above" >&2
  exit 1
fi

echo ""
echo "Done — data restored. Refresh Studio (localhost:8000) to see tables."
