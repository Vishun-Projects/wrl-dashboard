#!/usr/bin/env bash
# Apply read-model schema on the VPS Postgres (includes MIS client import v2).
# From Git Bash (repo root):
#   npm run db:apply-read-model:vps
#   bash scripts/vps-hosting/apply-read-model-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example and set VPS_HOST" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

REMOTE_SCRIPT="${INSTALL_ROOT}/scripts/vps-hosting/apply-read-model-remote.sh"

echo "==> Syncing app and applying read-model schema on ${VPS_HOST}"

tar -C "${ROOT}" -czf - \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='logs' \
  --exclude='.env' \
  --exclude='.env.local' \
  . | ssh "$VPS_HOST" \
  "mkdir -p '${INSTALL_ROOT}' && tar -xzf - -C '${INSTALL_ROOT}' && \
   rm -f '${INSTALL_ROOT}/.env' '${INSTALL_ROOT}/.env.local' && \
   chmod +x '${REMOTE_SCRIPT}' && \
   INSTALL_ROOT='${INSTALL_ROOT}' LOCAL_PG_PASS='${POSTGRES_PASSWORD:-}' \
   POOLER_TENANT_ID='${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}' \
   bash '${REMOTE_SCRIPT}'"

echo ""
echo "==> VPS read-model schema applied."
