#!/usr/bin/env bash
# Apply ARCP provision schema + ensure VPS sync-worker env for ARCP (no CRM fallback).
# From Git Bash (repo root), passphrase once:
#   bash scripts/vps-hosting/apply-arcp-provision-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
  -i "${SSH_KEY}"
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)"
fi
echo "==> Unlock SSH key ${SSH_KEY}"
ssh-add "$SSH_KEY"

echo "==> Detect install root"
detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'if [[ -L /opt/fast-close-app/current || -d /opt/fast-close-app/current ]]; then echo /opt/fast-close-app; elif [[ -d /opt/fast-close-app ]]; then echo /opt/fast-close-app; else find /opt -maxdepth 3 -type d -name fast-close-app 2>/dev/null | head -1; fi' || true)
INSTALL_ROOT="${detected_root:-$INSTALL_ROOT}"
echo "    INSTALL_ROOT=${INSTALL_ROOT}"

SQL_REMOTE="/tmp/53-arcp-provision-columns.sql"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/docs/read-model-phase1-schema/53-arcp-provision-columns.sql" \
  "${VPS_HOST}:${SQL_REMOTE}"

echo "==> Apply SQL on VPS Postgres"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
PASS=\$(grep -E '^POSTGRES_PASSWORD=' /opt/supabase/docker/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\\r' || true)
PASS=\${PASS:-${POSTGRES_PASSWORD:-}}
CONTAINER=\$(docker ps --format '{{.Names}}' | grep -E 'supabase-db|db' | head -1 || true)
if [[ -z "\$CONTAINER" ]]; then
  echo "FATAL: supabase db container not found" >&2
  exit 1
fi
docker exec -i -e PGPASSWORD="\$PASS" "\$CONTAINER" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ${SQL_REMOTE}
echo "    schema applied"
REMOTE

echo "==> Ensure .env.sync-worker ARCP flags"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
ROOT="${INSTALL_ROOT}"
CODE="\$ROOT"
[[ -L "\$ROOT/current" || -d "\$ROOT/current" ]] && CODE="\$ROOT/current"
ENVF=""
for f in "\$ROOT/shared/.env.sync-worker" "\$CODE/.env.sync-worker" "/opt/fast-close-app/shared/.env.sync-worker"; do
  if [[ -f "\$f" ]]; then ENVF="\$f"; break; fi
done
if [[ -z "\$ENVF" ]]; then
  mkdir -p "\$ROOT/shared"
  ENVF="\$ROOT/shared/.env.sync-worker"
  touch "\$ENVF"
fi
echo "    env file: \$ENVF"
ensure_kv() {
  local key="\$1" val="\$2"
  if grep -qE "^#{0,1}\${key}=" "\$ENVF"; then
    sed -i "s|^#{0,1}\${key}=.*|\${key}=\${val}|" "\$ENVF"
  else
    printf '%s=%s\\n' "\$key" "\$val" >> "\$ENVF"
  fi
}
ensure_kv SYNC_WORKER_ENABLED true
ensure_kv SYNC_ARCP_ENABLED true
ensure_kv SYNC_INTERVAL_MS 180000
ensure_kv READ_ARCP_FROM postgres
# Remove CRM fallback if present
sed -i '/^ARCP_CRM_FALLBACK_ON_EMPTY=/d' "\$ENVF" || true
grep -E '^(SYNC_WORKER_ENABLED|SYNC_ARCP_ENABLED|SYNC_INTERVAL_MS|READ_ARCP_FROM)=' "\$ENVF" || true
REMOTE

echo "==> Restart sync daemon + one-shot rate-card"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
systemctl restart fast-close-sync-worker || true
systemctl is-active fast-close-sync-worker || true
ROOT="${INSTALL_ROOT}"
CODE="\$ROOT"
[[ -L "\$ROOT/current" || -d "\$ROOT/current" ]] && CODE="\$ROOT/current"
cd "\$CODE"
export SYNC_WORKER_INSTALL_ROOT="\$CODE"
# Prefer shared env
set -a
[[ -f "\$ROOT/shared/.env.sync-worker" ]] && source <(sed 's/\\r\$//' "\$ROOT/shared/.env.sync-worker")
[[ -f "\$CODE/.env.sync-worker" ]] && source <(sed 's/\\r\$//' "\$CODE/.env.sync-worker")
set +a
export SYNC_ARCP_ENABLED=true
npm run sync-worker -- arcp-rate-card 2>&1 | tail -30
REMOTE

echo ""
echo "==> Done. ARCP provision schema + sync-worker ARCP flags updated on VPS."
