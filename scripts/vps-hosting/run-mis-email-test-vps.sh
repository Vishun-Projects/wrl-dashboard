#!/usr/bin/env bash
# Run MIS email test ON the VPS (Postfix on 127.0.0.1 — does not work from Windows locally).
# From Git Bash (repo root):
#   bash scripts/vps-hosting/run-mis-email-test-vps.sh
#
# Single SSH session: tar sync → remote script (no SSH multiplexing — works on Windows).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
TEST_TO="${MIS_EMAIL_TEST_TO:-vishnu.vishwakarma@westernequipments.com}"
TEST_CC="${MIS_EMAIL_TEST_CC:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example and set VPS_HOST" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Auto-detecting installation directory on VPS..."
detected_root=$(ssh "$VPS_HOST" 'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
  echo "    Detected root: $INSTALL_ROOT"
else
  INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
  echo "    Using default root: $INSTALL_ROOT"
fi

REMOTE_SCRIPT="${INSTALL_ROOT}/scripts/vps-hosting/run-mis-email-test-remote.sh"

echo "==> Syncing app and running mis-email:test on ${VPS_HOST} (one SSH session)"
echo "    To: ${TEST_TO}"
if [[ -n "$TEST_CC" ]]; then
  echo "    Cc: ${TEST_CC}"
fi

tar -C "${ROOT}" -czf - \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='logs' \
  --exclude='.env' \
  --exclude='.env.local' \
  . | ssh "$VPS_HOST" \
  "mkdir -p '${INSTALL_ROOT}' && tar -xzf - -C '${INSTALL_ROOT}' && \
   rm -f '${INSTALL_ROOT}/.env' '${INSTALL_ROOT}/.env.local' '${INSTALL_ROOT}/.env.mis-email' && \
   chmod +x '${REMOTE_SCRIPT}' && \
   INSTALL_ROOT='${INSTALL_ROOT}' MAIL_DOMAIN='${MAIL_DOMAIN:-wrl-fsm.cloud}' \
   MIS_EMAIL_TEST_TO='${TEST_TO}' MIS_EMAIL_TEST_CC='${TEST_CC}' LOCAL_PG_PASS='${POSTGRES_PASSWORD:-}' \
   MIS_SMTP_GMAIL_USER='${MIS_SMTP_GMAIL_USER:-}' \
   MIS_SMTP_GMAIL_APP_PASSWORD='${MIS_SMTP_GMAIL_APP_PASSWORD:-}' \
   POOLER_TENANT_ID='${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}' \
   bash '${REMOTE_SCRIPT}'"

echo ""
echo "==> Done. Check To/Cc inboxes (and spam)."
