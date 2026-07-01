#!/usr/bin/env bash
# Point Supabase GoTrue (forgot password) at the same SMTP as MIS reports.
# On VPS:
#   bash scripts/vps-hosting/sync-gotrue-smtp.sh
# From PC:
#   npm run gotrue:sync-smtp:vps
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/mis-smtp-env.sh"

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"
MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"

set_env() {
  local key="$1"
  local val="$2"
  grep -v "^${key}=" "${SUPABASE_DIR}/.env" > "${SUPABASE_DIR}/.env.tmp" 2>/dev/null || true
  mv "${SUPABASE_DIR}/.env.tmp" "${SUPABASE_DIR}/.env"
  printf '%s=%s\n' "$key" "$val" >> "${SUPABASE_DIR}/.env"
}

sync_gotrue_smtp() {
  if [[ ! -f "${SUPABASE_DIR}/.env" ]]; then
    echo "FATAL: missing ${SUPABASE_DIR}/.env — run repair-supabase-env.sh first" >&2
    exit 1
  fi

  load_mis_smtp_vars

  local gotrue_host admin_email sender_name
  gotrue_host="$(resolve_gotrue_smtp_host "$SMTP_HOST")"
  admin_email="$(parse_smtp_admin_email "$SMTP_FROM")"
  sender_name="$(parse_smtp_sender_name "$SMTP_FROM")"

  echo "==> GoTrue SMTP (same as MIS reports)"
  echo "    From: ${sender_name} <${admin_email}>"
  echo "    Relay: ${gotrue_host}:${SMTP_PORT} (MIS uses ${SMTP_HOST}:${SMTP_PORT})"
  if [[ -n "${SMTP_USER:-}" ]]; then
    echo "    Auth: ${SMTP_USER}"
  else
    echo "    Auth: none (local Postfix)"
  fi

  set_env SMTP_ADMIN_EMAIL "$admin_email"
  set_env SMTP_HOST "$gotrue_host"
  set_env SMTP_PORT "$SMTP_PORT"
  set_env SMTP_USER "${SMTP_USER:-}"
  set_env SMTP_PASS "${SMTP_PASS:-}"
  set_env SMTP_SENDER_NAME "$sender_name"

  echo "==> Recreating GoTrue (auth) so SMTP env is picked up"
  cd "$SUPABASE_DIR"
  docker compose up -d --force-recreate auth
  sleep 5
  docker compose ps auth
  echo "==> Done — test forgot password on https://wrl-dashboard.vercel.app/forgot-password"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  sync_gotrue_smtp
fi
