#!/usr/bin/env bash
# Patch /opt/supabase/docker/.env from .env.example + migration secrets (safe for special chars).
# Run on VPS after setup-supabase.sh or to fix "name resolution failed" Kong errors.
set -euo pipefail

API_DOMAIN="${API_DOMAIN:-api.wrl-fsm.cloud}"
SITE_URL="${SITE_URL:-https://wrl-dashboard.vercel.app}"
POOLER_TENANT_ID="${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"

for var in JWT_SECRET POSTGRES_PASSWORD ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env: $var" >&2
    exit 1
  fi
done

cd "$SUPABASE_DIR"

set_env() {
  local key="$1"
  local val="$2"
  grep -v "^${key}=" .env > .env.tmp 2>/dev/null || true
  mv .env.tmp .env
  printf '%s=%s\n' "$key" "$val" >> .env
}

if [[ ! -f .env.example ]]; then
  echo "Missing ${SUPABASE_DIR}/.env.example" >&2
  exit 1
fi

echo "==> Rebuilding .env from .env.example (keeps all Supabase defaults)"
cp .env.example .env

set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_env JWT_SECRET "$JWT_SECRET"
set_env ANON_KEY "$ANON_KEY"
set_env SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_env SUPABASE_PUBLIC_URL "https://${API_DOMAIN}"
set_env API_EXTERNAL_URL "https://${API_DOMAIN}"
set_env SITE_URL "$SITE_URL"
set_env ADDITIONAL_REDIRECT_URLS "${SITE_URL}/**,http://localhost:3000/**"
set_env POOLER_TENANT_ID "$POOLER_TENANT_ID"
set_env DASHBOARD_USERNAME "supabase"
set_env DASHBOARD_PASSWORD "$POSTGRES_PASSWORD"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "true"
set_env STUDIO_DEFAULT_ORGANIZATION "WRL"
set_env STUDIO_DEFAULT_PROJECT "fast-close-app"
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.pg17.yml"

echo "==> GoTrue SMTP — same relay as MIS reports (.env.mis-email)"
if [[ -f "$(dirname "$0")/mis-smtp-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/mis-smtp-env.sh"
  load_mis_smtp_vars
  gotrue_host="$(resolve_gotrue_smtp_host "$SMTP_HOST")"
  set_env SMTP_ADMIN_EMAIL "$(parse_smtp_admin_email "$SMTP_FROM")"
  set_env SMTP_HOST "$gotrue_host"
  set_env SMTP_PORT "$SMTP_PORT"
  set_env SMTP_USER "${SMTP_USER:-}"
  set_env SMTP_PASS "${SMTP_PASS:-}"
  set_env SMTP_SENDER_NAME "$(parse_smtp_sender_name "$SMTP_FROM")"
  echo "    From: $(parse_smtp_sender_name "$SMTP_FROM") <$(parse_smtp_admin_email "$SMTP_FROM")>"
  echo "    Relay: ${gotrue_host}:${SMTP_PORT}"
else
  echo "WARN: mis-smtp-env.sh not found — GoTrue SMTP not configured" >&2
fi

echo "==> Restarting Supabase stack"
docker compose down
docker compose pull
docker compose up -d
echo "Waiting for services..."
sleep 30
docker compose ps

echo "==> Local health (Kong → auth)"
curl -sf "http://127.0.0.1:8000/auth/v1/health" -H "apikey: ${ANON_KEY}" && echo || echo "WARN: local health failed — check: docker compose logs auth kong"
