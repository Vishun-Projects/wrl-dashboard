#!/usr/bin/env bash
# SSH to VPS and sync GoTrue SMTP from MIS reports config.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Syncing GoTrue SMTP on ${VPS_HOST} (same relay as MIS reports)"

tar -C "${ROOT}" -czf - \
  scripts/vps-hosting/mis-smtp-env.sh \
  scripts/vps-hosting/sync-gotrue-smtp.sh \
  scripts/vps-hosting/fix-postfix-docker-relay.sh \
  scripts/vps-hosting/docker-compose.auth-smtp.override.yml \
  | ssh "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"

ssh "$VPS_HOST" \
  "MAIL_DOMAIN='${MAIL_DOMAIN:-wrl-fsm.cloud}' MIS_SMTP_ENV_FILE='${INSTALL_ROOT}/.env.mis-email' \
   MIS_SMTP_GMAIL_USER='${MIS_SMTP_GMAIL_USER:-}' \
   MIS_SMTP_GMAIL_APP_PASSWORD='${MIS_SMTP_GMAIL_APP_PASSWORD:-}' \
   bash '${INSTALL_ROOT}/scripts/vps-hosting/sync-gotrue-smtp.sh'"
