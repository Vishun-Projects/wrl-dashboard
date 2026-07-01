#!/usr/bin/env bash
# Shared SMTP resolution — same source as MIS digest (src/lib/mis-email/send.ts).
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

# GoTrue runs in Docker — host Postfix is not reachable at 127.0.0.1 from the container.
resolve_gotrue_smtp_host() {
  local host="${1:-127.0.0.1}"
  case "$host" in
    127.0.0.1 | localhost) echo "172.17.0.1" ;;
    *) echo "$host" ;;
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
