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
INSTALL_ROOT="${INSTALL_ROOT%/current}"
SERVICE_NAME="fast-close-sync-worker"

install_systemd_nightly_timer() {
  local base="${1:?}"
  local code
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    code="${base}/current"
  else
    code="$base"
  fi
  local shared_env="${base}/shared/.env.sync-worker"
  local log_dir="${base}/shared/logs"
  [[ -d "$log_dir" ]] || log_dir="${code}/logs"
  local service_name="fast-close-sync-worker-nightly"
  local service_unit="/etc/systemd/system/${service_name}.service"
  local timer_unit="/etc/systemd/system/${service_name}.timer"

  echo "==> Installing nightly YTD refresh timer ${timer_unit}"
  cat >"$service_unit" <<EOF
[Unit]
Description=Fast Close CRM read-model nightly editedon catch-up (YTD status replay)
Documentation=file://${code}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${code}
Environment=SYNC_WORKER_INSTALL_ROOT=${code}
EnvironmentFile=-${shared_env}
EnvironmentFile=-${code}/.env.sync-worker
ExecStart=${code}/scripts/vps-hosting/sync-worker-nightly.sh
StandardOutput=append:${log_dir}/sync-worker-nightly.log
StandardError=append:${log_dir}/sync-worker-nightly.log
EOF

  cat >"$timer_unit" <<EOF
[Unit]
Description=Daily Fast Close CRM editedon catch-up (02:30)

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  chmod 644 "$service_unit" "$timer_unit"
  systemctl daemon-reload
  systemctl enable "${service_name}.timer"
  systemctl restart "${service_name}.timer"
  echo "    systemctl list-timers ${service_name}.timer"
  systemctl --no-pager list-timers "${service_name}.timer" || true
}

install_systemd_unit() {
  local base="${1:?}"
  local code
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    code="${base}/current"
  else
    code="$base"
  fi
  local shared_env="${base}/shared/.env.sync-worker"
  local log_dir="${base}/shared/logs"
  [[ -d "$log_dir" ]] || log_dir="${code}/logs"
  local service_name="fast-close-sync-worker"
  local unit="/etc/systemd/system/${service_name}.service"

  echo "==> Installing systemd unit ${unit} (code=${code})"
  cat >"$unit" <<EOF
[Unit]
Description=Fast Close CRM read-model sync worker (incremental + pipeline reconcile + editedon catch-up every 3 min)
Documentation=file://${code}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${code}
Environment=SYNC_WORKER_INSTALL_ROOT=${code}
EnvironmentFile=-${shared_env}
EnvironmentFile=-${code}/.env.sync-worker
ExecStart=${code}/scripts/vps-hosting/sync-worker-daemon.sh
Restart=always
RestartSec=30
StandardOutput=append:${log_dir}/sync-worker.log
StandardError=append:${log_dir}/sync-worker.log

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
  local base="${1:?}"
  base="${base%/current}"
  echo "==> Sync worker daemon install at ${base}"

  mkdir -p "${base}/logs" "${base}/scripts/vps-hosting" "${base}/shared/logs"

  if ! command -v node >/dev/null 2>&1; then
    echo "==> Installing Node.js 20"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  fi
  echo "    Node $(node -v)"

  # Prefer release layout if helpers are present
  if [[ -f "${base}/scripts/vps-hosting/vps-release-lib.sh" ]]; then
    # shellcheck disable=SC1091
    source "${base}/scripts/vps-hosting/vps-release-lib.sh"
    vps_migrate_flat_to_releases "$base"
  elif [[ -f /tmp/vps-release-lib.sh ]]; then
    # shellcheck disable=SC1091
    source /tmp/vps-release-lib.sh
    vps_migrate_flat_to_releases "$base"
  fi

  local code
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    code="${base}/current"
  else
    code="$base"
  fi

  if [[ -f "${code}/package.json" ]]; then
    echo "==> Installing npm dependencies into shared/"
    mkdir -p "${base}/shared"
    cp -a "${code}/package.json" "${base}/shared/" 2>/dev/null || true
    cp -a "${code}/package-lock.json" "${base}/shared/" 2>/dev/null || true
    cd "${base}/shared"
    npm ci 2>/dev/null || npm install
    if [[ -L "${base}/current" || -d "${base}/current" ]]; then
      vps_link_shared_into_release "$base" "$(readlink -f "${base}/current")"
    fi
  else
    echo "FATAL: ${code}/package.json not found — sync repo to VPS first" >&2
    exit 1
  fi

  chmod +x "${code}/scripts/vps-hosting/sync-worker-daemon.sh" 2>/dev/null || true
  chmod +x "${code}/scripts/vps-hosting/sync-worker-nightly.sh" 2>/dev/null || true

  if [[ ! -f "${base}/shared/.env.sync-worker" ]]; then
    if [[ -f "${code}/scripts/vps-hosting/.env.sync-worker.example" ]]; then
      cp "${code}/scripts/vps-hosting/.env.sync-worker.example" "${base}/shared/.env.sync-worker"
      echo "==> Created ${base}/shared/.env.sync-worker — set DATABASE_URL and SYNC_WORKER_ENABLED=true"
    fi
  fi
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    vps_link_shared_into_release "$base" "$(readlink -f "${base}/current")"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    install_systemd_unit "${base}"
    install_systemd_nightly_timer "${base}"
  else
    echo "WARN: systemctl not found — install systemd unit manually or use cron (not recommended for daemon)"
    echo "    Test: bash ${code}/scripts/vps-hosting/sync-worker-daemon.sh"
  fi

  echo "==> Sync worker daemon ready at ${base} (code=${code})"
  echo "    Logs: tail -f ${base}/shared/logs/sync-worker.log"
  echo "    Nightly: tail -f ${base}/shared/logs/sync-worker-nightly.log"
  echo "    Status: systemctl status fast-close-sync-worker"
  echo "    Deploys: npm run sync-worker:deploy:vps"
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

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
)

echo "==> Syncing app to ${VPS_HOST}:${INSTALL_ROOT}"
echo "    Tip: for code-only updates use: npm run sync-worker:deploy:vps"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/logs'"

if command -v rsync >/dev/null 2>&1; then
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
  rsync -az -e "$RSYNC_SSH" \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.git' \
    --exclude 'logs' \
    --exclude '.env' \
    --exclude '.env.local' \
    "${ROOT}/" "${VPS_HOST}:${INSTALL_ROOT}/"
else
  echo "    (rsync not found — using tar over ssh; install rsync for faster deploys)"
  echo "    Windows: winget install rsync  OR  choco install rsync"
  tar -C "${ROOT}" -czf - \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='logs' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='assets' \
    --exclude='public' \
    --exclude='scripts/crm_mirror' \
    --exclude='docs' \
    --exclude='.cursor' \
    . | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}' && tar -xzf - -C '${INSTALL_ROOT}'"
fi

RSYNC_SSH="ssh ${SSH_OPTS[*]}"
copy_one() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -az -e "$RSYNC_SSH" "$1" "${VPS_HOST}:$2"
  else
    scp "${SSH_OPTS[@]}" "$1" "${VPS_HOST}:$2"
  fi
}

copy_one "${ROOT}/scripts/vps-hosting/sync-worker-daemon.sh" \
  "${INSTALL_ROOT}/scripts/vps-hosting/sync-worker-daemon.sh"
copy_one "${ROOT}/scripts/vps-hosting/sync-worker-nightly.sh" \
  "${INSTALL_ROOT}/scripts/vps-hosting/sync-worker-nightly.sh"
copy_one "${ROOT}/scripts/vps-hosting/.env.sync-worker.example" \
  "${INSTALL_ROOT}/scripts/vps-hosting/.env.sync-worker.example"
copy_one "${ROOT}/scripts/vps-hosting/setup-sync-worker-daemon.sh" \
  "${INSTALL_ROOT}/scripts/vps-hosting/setup-sync-worker-daemon.sh"
copy_one "${ROOT}/scripts/vps-hosting/vps-release-lib.sh" \
  "${INSTALL_ROOT}/scripts/vps-hosting/vps-release-lib.sh"
scp "${SSH_OPTS[@]}" "${ROOT}/scripts/vps-hosting/vps-release-lib.sh" \
  "${VPS_HOST}:/tmp/vps-release-lib.sh"

echo "==> Running install on VPS"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "SYNC_WORKER_INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<REMOTE
$(declare -f install_systemd_unit install_systemd_nightly_timer run_install_on_machine)
# shellcheck disable=SC1091
source /tmp/vps-release-lib.sh
run_install_on_machine '${INSTALL_ROOT}'
REMOTE

echo ""
echo "Next steps:"
echo "  1. ssh ${VPS_HOST}"
echo "  2. nano ${INSTALL_ROOT}/shared/.env.sync-worker   # DATABASE_URL, SYNC_WORKER_ENABLED=true"
echo "  3. systemctl restart fast-close-sync-worker"
echo "  4. tail -f ${INSTALL_ROOT}/shared/logs/sync-worker.log"
echo "  Code updates: npm run sync-worker:deploy:vps"
echo "  Rollback:     npm run sync-worker:rollback:vps"
