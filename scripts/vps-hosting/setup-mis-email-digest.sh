#!/usr/bin/env bash
# One-time VPS setup for per-user MIS email digest times (IST).
# From Git Bash (repo root):
#   bash scripts/vps-hosting/setup-mis-email-digest.sh
# On VPS after manual copy:
#   MIS_EMAIL_INSTALL_ROOT=/opt/fast-close-app bash setup-mis-email-digest.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"

run_install_on_machine() {
  local root="${1:?}"
  echo "==> MIS email digest install at ${root}"

  mkdir -p "${root}/logs" "${root}/scripts/vps-hosting"

  if ! command -v node >/dev/null 2>&1; then
    echo "==> Installing Node.js 20"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  fi
  echo "    Node $(node -v)"

  if [[ -f "${root}/package.json" ]]; then
    echo "==> Installing npm dependencies"
    cd "${root}"
    npm ci --omit=dev 2>/dev/null || npm install --omit=dev
  else
    echo "FATAL: ${root}/package.json not found — sync repo to VPS first" >&2
    exit 1
  fi

  chmod +x "${root}/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null || true

  if [[ ! -f "${root}/.env.mis-email" ]]; then
    if [[ -f "${root}/scripts/vps-hosting/.env.mis-email.example" ]]; then
      cp "${root}/scripts/vps-hosting/.env.mis-email.example" "${root}/.env.mis-email"
      echo "==> Created ${root}/.env.mis-email — set SMTP_PASS and DATABASE_URL"
    fi
  fi

  echo "==> MIS email digest ready at ${root}"
  echo "    Test: bash ${root}/scripts/vps-hosting/mis-email-digest.sh"
  echo "    Or:   cd ${root} && npm run mis-email:test"
  echo "    Cron (every 15 min Mon–Sat IST; schedule from portal):"
  echo "    CRON_TZ=Asia/Kolkata"
  echo "    */15 * * * 1-6 ${root}/scripts/vps-hosting/mis-email-digest.sh >> ${root}/logs/mis-email-cron.log 2>&1"
}

if [[ "${1:-}" == "--local" ]]; then
  run_install_on_machine "$INSTALL_ROOT"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example and fill VPS_HOST" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Syncing app to ${VPS_HOST}:${INSTALL_ROOT}"
ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/logs'"

if command -v rsync >/dev/null 2>&1; then
  rsync -az \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude 'logs' \
    --exclude '.env' \
    --exclude '.env.local' \
    "${ROOT}/" "${VPS_HOST}:${INSTALL_ROOT}/"
else
  echo "    (rsync not found — using tar over ssh)"
  tar -C "${ROOT}" -czf - \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='.env' \
    --exclude='.env.local' \
    . | ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}' && tar -xzf - -C '${INSTALL_ROOT}'"
fi

scp "${ROOT}/scripts/vps-hosting/mis-email-digest.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh"
scp "${ROOT}/scripts/vps-hosting/.env.mis-email.example" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/.env.mis-email.example"

echo "==> Running install on VPS"
ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<REMOTE
$(declare -f run_install_on_machine)
run_install_on_machine '${INSTALL_ROOT}'
REMOTE

echo ""
echo "Next steps:"
echo "  1. ssh ${VPS_HOST}"
echo "  2. nano ${INSTALL_ROOT}/.env.mis-email   # SMTP_PASS, DATABASE_URL"
echo "  3. cd ${INSTALL_ROOT} && npm run mis-email:test"
echo "  4. npm run mis-email:install-cron:vps   # every 15 min; schedule from portal"
