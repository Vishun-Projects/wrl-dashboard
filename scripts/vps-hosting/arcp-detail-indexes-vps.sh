#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"

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

REMOTE_DIR="${INSTALL_ROOT}/scripts/vps-hosting"
REMOTE_SCRIPT="${REMOTE_DIR}/arcp-detail-indexes-remote.sh"

echo "==> Syncing ARCP detail index helper to ${VPS_HOST}:${REMOTE_SCRIPT}"
ssh "$VPS_HOST" "mkdir -p '${REMOTE_DIR}'"
scp "${ROOT}/scripts/vps-hosting/arcp-detail-indexes-remote.sh" "${VPS_HOST}:${REMOTE_SCRIPT}"
ssh "$VPS_HOST" "chmod +x '${REMOTE_SCRIPT}'"

echo "==> Creating ARCP detail export index on VPS..."
ssh -t "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash '${REMOTE_SCRIPT}'"
