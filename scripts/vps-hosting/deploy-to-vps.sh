#!/usr/bin/env bash
# Run from Git Bash on Windows (repo root or scripts/vps-hosting).
# Requires: ssh/scp access to VPS, optional pg_dump for migrate step.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example and fill in values" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

STEP="${1:-all}"

deploy_setup() {
  echo "==> Copying setup scripts to VPS"
  scp "${ROOT}/scripts/vps-hosting/setup-supabase.sh" "${VPS_HOST}:/root/setup-supabase.sh"
  scp "${ROOT}/scripts/vps-hosting/repair-supabase-env.sh" "${VPS_HOST}:/root/repair-supabase-env.sh"

  echo "==> Running Supabase setup on VPS (10–20 min)"
  ssh "$VPS_HOST" bash -s <<REMOTE
export JWT_SECRET='${JWT_SECRET}'
export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
export ANON_KEY='${ANON_KEY}'
export SERVICE_ROLE_KEY='${SERVICE_ROLE_KEY}'
bash /root/setup-supabase.sh
REMOTE
}

deploy_repair() {
  echo "==> Repairing Supabase .env on VPS (fixes Kong name resolution failed)"
  scp "${ROOT}/scripts/vps-hosting/repair-supabase-env.sh" "${VPS_HOST}:/root/repair-supabase-env.sh"
  ssh "$VPS_HOST" bash -s <<REMOTE
export JWT_SECRET='${JWT_SECRET}'
export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
export ANON_KEY='${ANON_KEY}'
export SERVICE_ROLE_KEY='${SERVICE_ROLE_KEY}'
bash /root/repair-supabase-env.sh
REMOTE
}

deploy_migrate() {
  echo "==> Dumping cloud DB and restoring on VPS (pg_dump runs on server)"
  CLOUD_DB_PASSWORD="${CLOUD_DB_PASSWORD}" \
  CLOUD_POOLER_HOST="${CLOUD_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}" \
  VPS_HOST="${VPS_HOST}" \
  ANON_KEY="${ANON_KEY}" \
  bash "${ROOT}/scripts/vps-hosting/migrate-db-from-cloud.sh"
}

case "$STEP" in
  setup) deploy_setup ;;
  repair) deploy_repair ;;
  migrate) deploy_migrate ;;
  restore)
    echo "==> Restore existing dump only (SKIP_DUMP=true)"
    CLOUD_DB_PASSWORD="${CLOUD_DB_PASSWORD}" \
    VPS_HOST="${VPS_HOST}" \
    ANON_KEY="${ANON_KEY}" \
    SKIP_DUMP=true \
    bash "${ROOT}/scripts/vps-hosting/migrate-db-from-cloud.sh"
    ;;
  all)
    deploy_setup
    deploy_migrate
    ;;
  *)
    echo "Usage: $0 [setup|repair|migrate|restore|all]" >&2
    exit 1
    ;;
esac

echo ""
echo "Done."
echo "Health check (Git Bash): curl -s https://api.wrl-fsm.cloud/auth/v1/health -H \"apikey: \$ANON_KEY\""
echo "Health check (PowerShell): curl.exe -s https://api.wrl-fsm.cloud/auth/v1/health -H \"apikey: YOUR_ANON_KEY\""
echo "Then update Vercel env to match .env.local and redeploy."
