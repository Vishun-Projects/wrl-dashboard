#!/usr/bin/env bash
# One-time VPS setup: systemd service for npm run sync-worker:daemon (every 3 min).
# From Git Bash (repo root):
#   bash scripts/vps-hosting/setup-sync-worker-daemon.sh
# On VPS after manual copy:
#   SYNC_WORKER_INSTALL_ROOT=/opt/fast-close-app bash setup-sync-worker-daemon.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
SERVICE_NAME="fast-close-sync-worker"

install_systemd_unit() {
  local root="${1:?}"
  local service_name="fast-close-sync-worker"
  local unit="/etc/systemd/system/${service_name}.service"

  echo "==> Installing systemd unit ${unit}"
  cat >"$unit" <<EOF
[Unit]
Description=Fast Close CRM read-model sync worker (incremental every 3 min)
Documentation=file://${root}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
Environment=SYNC_WORKER_INSTALL_ROOT=${root}
EnvironmentFile=-${root}/.env.sync-worker
ExecStart=${root}/scripts/vps-hosting/sync-worker-daemon.sh
Restart=always
RestartSec=30
StandardOutput=append:${root}/logs/sync-worker.log
StandardError=append:${root}/logs/sync-worker.log

[Install]
WantedBy=multi-user.target
EOF

  chmod 644 "$unit"
  systemctl daemon-reload
  systemctl enable "${service_name}"
  systemctl restart "${service_name}"
  echo "    systemctl status ${service_name}"
  systemctl --no-pager --full status "${service_name}" || true
}

run_install_on_machine() {
  local root="${1:?}"
  echo "==> Sync worker daemon install at ${root}"

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
    npm ci 2>/dev/null || npm install
  else
    echo "FATAL: ${root}/package.json not found — sync repo to VPS first" >&2
    exit 1
  fi

  chmod +x "${root}/scripts/vps-hosting/sync-worker-daemon.sh" 2>/dev/null || true

  if [[ ! -f "${root}/.env.sync-worker" ]]; then
    if [[ -f "${root}/scripts/vps-hosting/.env.sync-worker.example" ]]; then
      cp "${root}/scripts/vps-hosting/.env.sync-worker.example" "${root}/.env.sync-worker"
      echo "==> Created ${root}/.env.sync-worker — set DATABASE_URL and SYNC_WORKER_ENABLED=true"
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    install_systemd_unit "${root}"
  else
    echo "WARN: systemctl not found — install systemd unit manually or use cron (not recommended for daemon)"
    echo "    Test: bash ${root}/scripts/vps-hosting/sync-worker-daemon.sh"
  fi

  echo "==> Sync worker daemon ready at ${root}"
  echo "    Logs: tail -f ${root}/logs/sync-worker.log"
  echo "    Status: systemctl status fast-close-sync-worker"
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

scp "${ROOT}/scripts/vps-hosting/sync-worker-daemon.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/sync-worker-daemon.sh"
scp "${ROOT}/scripts/vps-hosting/.env.sync-worker.example" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/.env.sync-worker.example"
scp "${ROOT}/scripts/vps-hosting/setup-sync-worker-daemon.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/setup-sync-worker-daemon.sh"

echo "==> Running install on VPS"
ssh "$VPS_HOST" "SYNC_WORKER_INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<REMOTE
$(declare -f install_systemd_unit run_install_on_machine)
run_install_on_machine '${INSTALL_ROOT}'
REMOTE

echo ""
echo "Next steps:"
echo "  1. ssh ${VPS_HOST}"
echo "  2. nano ${INSTALL_ROOT}/.env.sync-worker   # DATABASE_URL, SYNC_WORKER_ENABLED=true"
echo "  3. systemctl restart fast-close-sync-worker"
echo "  4. tail -f ${INSTALL_ROOT}/logs/sync-worker.log"
