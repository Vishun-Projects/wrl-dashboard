#!/usr/bin/env bash
# Runs ON the VPS — restore /root/supabase_cloud.dump into self-hosted Supabase PG17.
# Invoked by migrate-db-from-cloud.sh via scp + ssh.
set -euo pipefail

CLOUD_DB_PASSWORD="${CLOUD_DB_PASSWORD:?CLOUD_DB_PASSWORD required}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"
API_DOMAIN="${API_DOMAIN:-api.wrl-fsm.cloud}"
ANON_KEY="${ANON_KEY:-}"
SKIP_DUMP="${SKIP_DUMP:-false}"
PROJECT_REF="${PROJECT_REF:-ddmapuyghfeoyajxbcjh}"
CLOUD_DIRECT_HOST="${CLOUD_DIRECT_HOST:-db.${PROJECT_REF}.supabase.co}"
CLOUD_POOLER_HOST="${CLOUD_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}"

DUMP="/root/supabase_cloud.dump"
COMPOSE="docker-compose.yml:docker-compose.pg17.yml"
NETWORK="supabase_default"

ensure_pg17() {
  cd "$SUPABASE_DIR"
  grep -v '^COMPOSE_FILE=' .env > .env.tmp 2>/dev/null || true
  mv .env.tmp .env
  printf '%s=%q\n' COMPOSE_FILE "$COMPOSE" >> .env
  export COMPOSE_FILE="$COMPOSE"

  local ver
  ver=$(docker compose exec -T db psql -U postgres -tAc "SHOW server_version_num;" 2>/dev/null || echo "0")
  if [[ "${ver}" -ge 170000 ]] && docker compose exec -T db pg_isready -U postgres -q 2>/dev/null; then
    echo "==> Postgres 17 already running (server_version_num=${ver})"
    return 0
  fi

  echo "==> Recreating stack with Postgres 17 (was ${ver:-unknown})..."
  echo "==> Removing PG15 bind-mount data (down -v does NOT delete volumes/db/data)"
  docker compose down -v 2>/dev/null || true
  rm -rf "${SUPABASE_DIR}/volumes/db/data"

  docker compose pull
  docker compose up -d db
  echo "Waiting for Postgres 17 to become ready..."
  for i in $(seq 1 90); do
    if docker compose exec -T db pg_isready -U postgres -q 2>/dev/null; then
      echo "==> Postgres 17 ready"
      break
    fi
    if [[ "$i" -eq 90 ]]; then
      echo "ERROR: Postgres 17 failed to start. Logs:" >&2
      docker compose logs db --tail 80 >&2
      exit 1
    fi
    sleep 2
  done
  docker compose up -d
  sleep 20
  docker compose exec db psql -U postgres -c "SELECT version();"
}

run_dump() {
  local url="$1"
  local label="$2"
  echo "==> Trying pg_dump 17 via Docker (${label})..."
  if docker run --rm --network host \
    -v /root:/backup \
    postgres:17 \
    pg_dump "$url" --format=custom --no-owner --no-acl --verbose -f /backup/supabase_cloud.dump; then
    echo "==> Dump OK (${label})"
    return 0
  fi
  echo "==> Dump failed (${label})"
  return 1
}

run_restore() {
  cd "$SUPABASE_DIR"
  export COMPOSE_FILE="$COMPOSE"

  if [[ ! -f "$DUMP" ]]; then
    echo "ERROR: Missing $DUMP — run migrate without SKIP_DUMP first" >&2
    exit 1
  fi

  echo "==> Restoring $DUMP with pg_restore 17 ($(du -h "$DUMP" | cut -f1))..."
  docker compose stop auth rest realtime storage meta studio kong supavisor 2>/dev/null || true

  set +e
  docker run --rm \
    --network "$NETWORK" \
    -v /root:/backup \
    -e PGPASSWORD="${CLOUD_DB_PASSWORD}" \
    postgres:17 \
    pg_restore \
      -h db -p 5432 -U postgres -d postgres \
      --clean --if-exists --no-owner --no-acl --verbose \
      /backup/supabase_cloud.dump
  local restore_exit=$?
  set -e
  echo "==> pg_restore exit code: ${restore_exit} (1 often means warnings; verifying data...)"

  docker compose up -d
  sleep 25

  local users hot public_tables
  users=$(docker compose exec -T db psql -U postgres -tAc "SELECT count(*) FROM auth.users;" 2>/dev/null || echo "0")
  hot=$(docker compose exec -T db psql -U postgres -tAc "SELECT count(*) FROM calls_latest_hot;" 2>/dev/null || echo "0")
  public_tables=$(docker compose exec -T db psql -U postgres -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null || echo "0")

  echo "==> After restore: auth.users=${users}, calls_latest_hot=${hot}, public tables=${public_tables}"

  if [[ "${users}" -lt 1 ]] || [[ "${public_tables}" -lt 1 ]]; then
    echo "ERROR: Restore did not load data. Check: docker compose logs db --tail 30" >&2
    exit 1
  fi
}

ensure_pg17

if [[ "$SKIP_DUMP" != "true" ]]; then
  DIRECT_URL="postgresql://postgres:${CLOUD_DB_PASSWORD}@${CLOUD_DIRECT_HOST}:5432/postgres"
  POOLER_URL="postgresql://postgres.${PROJECT_REF}:${CLOUD_DB_PASSWORD}@${CLOUD_POOLER_HOST}:5432/postgres"
  if ! run_dump "$DIRECT_URL" "direct db.${PROJECT_REF}.supabase.co"; then
    if ! run_dump "$POOLER_URL" "pooler ${CLOUD_POOLER_HOST}:5432"; then
      echo "ERROR: Dump failed." >&2
      exit 1
    fi
  fi
  ls -lh "$DUMP"
else
  echo "==> Skipping dump (SKIP_DUMP=true), using existing $DUMP"
  ls -lh "$DUMP"
fi

run_restore

echo "==> Restore verified OK"
if [[ -n "$ANON_KEY" ]]; then
  curl -sf "https://${API_DOMAIN}/auth/v1/health" -H "apikey: ${ANON_KEY}" && echo
fi
