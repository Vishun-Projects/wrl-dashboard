#!/usr/bin/env bash
# Print SPF + DKIM DNS records to add in Hostinger (no personal email credentials).
# From Git Bash: npm run mis-email:dns:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mis}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST}"

scp -q "${ROOT}/scripts/vps-hosting/setup-vps-postfix.sh" "${VPS_HOST}:/root/setup-vps-postfix.sh"
ssh -t "$VPS_HOST" \
  "MAIL_DOMAIN='${MAIL_DOMAIN}' DKIM_SELECTOR='${DKIM_SELECTOR}' bash /root/setup-vps-postfix.sh --dns-only"
