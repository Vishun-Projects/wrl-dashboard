#!/usr/bin/env bash
# Shared SMTP resolution — same source as MIS digest (src/modules/mis-email/services/send.ts).
# Source this file, then call load_mis_smtp_vars.

load_mis_smtp_vars() {
  local env_file="${MIS_SMTP_ENV_FILE:-/opt/fast-close-app/.env.mis-email}"
  local mail_domain="${MAIL_DOMAIN:-wrl-fsm.cloud}"

  SMTP_HOST=""
  SMTP_PORT="587"
  SMTP_USER=""
  SMTP_PASS=""
  SMTP_FROM=""
  SMTP_SECURE="false"

  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$env_file"
    set +a
  fi

  if [[ -n "${MIS_SMTP_GMAIL_USER:-}" && -n "${MIS_SMTP_GMAIL_APP_PASSWORD:-}" ]]; then
    SMTP_HOST="smtp.gmail.com"
    SMTP_PORT="587"
    SMTP_SECURE="false"
    SMTP_USER="${MIS_SMTP_GMAIL_USER}"
    SMTP_PASS="${MIS_SMTP_GMAIL_APP_PASSWORD}"
    SMTP_FROM="${SMTP_FROM:-WRL MIS Reports <${MIS_SMTP_GMAIL_USER}>}"
  fi

  if [[ -z "${SMTP_HOST:-}" ]]; then
    SMTP_HOST="127.0.0.1"
    SMTP_PORT="25"
    SMTP_SECURE="false"
    SMTP_FROM="${SMTP_FROM:-WRL MIS Reports <reports@${mail_domain}>}"
  fi
}

# GoTrue runs on the Supabase Docker network (usually 172.18.x), not the default bridge.
detect_docker_host_gateway() {
  if command -v docker >/dev/null 2>&1; then
    local gw=""
    if docker inspect supabase-auth >/dev/null 2>&1; then
      gw="$(docker inspect supabase-auth --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{println}}{{end}}' 2>/dev/null | head -1 | tr -d '[:space:]')"
    fi
    if [[ -z "$gw" ]]; then
      for net in supabase_default docker_default; do
        gw="$(docker network inspect "$net" --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null | tr -d '[:space:]')"
        [[ -n "$gw" ]] && break
      done
    fi
    if [[ -n "$gw" ]]; then
      printf '%s' "$gw"
      return 0
    fi
  fi
  printf '%s' "172.18.0.1"
}

# Host Postfix listens on the VPS; GoTrue must use the Docker network gateway IP.
resolve_gotrue_smtp_host() {
  local host="${1:-127.0.0.1}"
  case "$host" in
    127.0.0.1 | localhost) detect_docker_host_gateway ;;
    *) printf '%s' "$host" ;;
  esac
}

parse_smtp_admin_email() {
  local from="${1:-}"
  local email
  email="$(printf '%s' "$from" | sed -n 's/.*<\([^>]*\)>.*/\1/p')"
  if [[ -n "$email" ]]; then
    printf '%s' "$email"
  else
    printf '%s' "$from"
  fi
}

parse_smtp_sender_name() {
  local from="${1:-}"
  local name
  name="$(printf '%s' "$from" | sed -n 's/^\([^<]*\)<.*/\1/p' | sed 's/[[:space:]]*$//')"
  if [[ -n "$name" ]]; then
    printf '%s' "$name"
  else
    printf 'WRL MIS Reports'
  fi
}
