#!/usr/bin/env bash
# Runs ON the VPS — applies read-model SQL (including MIS client import v2).
set -euo pipefail

root="${INSTALL_ROOT:-/opt/fast-close-app}"
cd "${root}"

rm -f "${root}/.env" "${root}/.env.local"

resolve_database_url() {
  local db_url="" f line pass
  local tenant="${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}"

  pass=""
  if [[ -f /opt/supabase/docker/.env ]]; then
    # shellcheck disable=SC1091
    set -a
    source /opt/supabase/docker/.env
    set +a
    pass="${POSTGRES_PASSWORD:-}"
    tenant="${POOLER_TENANT_ID:-${tenant}}"
  fi
  if [[ -z "$pass" && -n "${LOCAL_PG_PASS:-}" ]]; then
    pass="${LOCAL_PG_PASS}"
  fi
  if [[ -n "$pass" ]]; then
    echo "postgresql://postgres.${tenant}:${pass}@127.0.0.1:6543/postgres?pgbouncer=true"
    return 0
  fi

  for f in "${root}/.env.mis-email" "${root}/.env" "${root}/.env.local"; do
    if [[ -f "$f" ]]; then
      line=$(grep -E '^DATABASE_URL=' "$f" 2>/dev/null | head -1 || true)
      if [[ -n "$line" && "$line" != *CHANGE_ME* && "$line" != *prisma+postgres* ]]; then
        db_url="${line#DATABASE_URL=}"
        db_url="${db_url%\"}"
        db_url="${db_url#\"}"
        db_url="${db_url#\'}"
        db_url="${db_url%\'}"
        echo "$db_url"
        return 0
      fi
    fi
  done

  return 1
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    echo "==> Node $(node -v)"
    return 0
  fi
  echo "==> Installing Node.js 20"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo "    Node $(node -v) installed"
}

ensure_node

db_url=""
if ! db_url="$(resolve_database_url)"; then
  echo "FATAL: Could not resolve DATABASE_URL." >&2
  echo "  Set POSTGRES_PASSWORD in .env.vps-setup on your PC." >&2
  exit 1
fi
echo "==> DATABASE_URL resolved (pooler @ 127.0.0.1:6543)"

echo "==> npm install (for pg + dotenv)"
# VPS has no git hooks checkout — husky prepare fails with exit 127.
npm install --omit=dev --ignore-scripts 2>&1 | tail -5

echo "==> Applying read-model schema"
DATABASE_URL="${db_url}" npm run db:apply-read-model

echo "==> Seeding MIS client config (coke + cadbury)"
DATABASE_URL="${db_url}" npm run db:seed-mis-client

echo "==> Done."
