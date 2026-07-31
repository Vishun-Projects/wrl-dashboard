#!/usr/bin/env bash
# Push sync-worker code to VPS and restart the daemon (no full npm ci).
# Lighter than setup-sync-worker-daemon.sh — use after code changes.
#
#   npm run sync-worker:deploy:vps
#
# Requires: .env.vps-setup with VPS_HOST, SSH key with access to VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Auto-detecting installation directory on VPS..."
detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" 'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
  echo "    Detected root: $INSTALL_ROOT"
else
  INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
  echo "    Using default root: $INSTALL_ROOT"
fi

echo "==> Deploying sync-worker code to ${VPS_HOST}:${INSTALL_ROOT}"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/src/lib' '${INSTALL_ROOT}/src/modules' '${INSTALL_ROOT}/src/sql' '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/docs/read-model-phase1-schema' '${INSTALL_ROOT}/logs'"

# Upload .env.sync-worker if VPS is missing it (never overwrite an existing remote file)
if [[ -f "${ROOT}/.env.sync-worker" ]]; then
  remote_has_env=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" "test -f '${INSTALL_ROOT}/.env.sync-worker' && echo yes || echo no")
  if [[ "$remote_has_env" == "no" ]]; then
    echo "==> Uploading .env.sync-worker (missing on VPS)"
    scp "${SSH_OPTS[@]}" "${ROOT}/.env.sync-worker" "${VPS_HOST}:${INSTALL_ROOT}/.env.sync-worker"
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" "chmod 600 '${INSTALL_ROOT}/.env.sync-worker'"
  else
    echo "==> Keeping existing VPS .env.sync-worker"
  fi
fi

if command -v rsync >/dev/null 2>&1; then
  # rsync -e needs ssh opts as a single string
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/lib/" "${VPS_HOST}:${INSTALL_ROOT}/src/lib/"
  # sync CLI imports @/modules/arcp + @/sql — keep them in sync with package.json scripts
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/modules/" "${VPS_HOST}:${INSTALL_ROOT}/src/modules/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/sql/" "${VPS_HOST}:${INSTALL_ROOT}/src/sql/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/docs/read-model-phase1-schema/" \
    "${VPS_HOST}:${INSTALL_ROOT}/docs/read-model-phase1-schema/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/scripts/" "${VPS_HOST}:${INSTALL_ROOT}/scripts/"
else
  echo "    (rsync not found — streaming src/lib + src/modules + src/sql + package/schema files via tar)"
  tar -C "${ROOT}" -czf - \
    src/lib \
    src/modules \
    src/sql \
    package.json \
    package-lock.json \
    tsconfig.json \
    docs/read-model-phase1-schema \
    scripts \
    | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"
fi

echo "==> Updating systemd unit + restarting sync worker"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "SYNC_WORKER_INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<'REMOTE'
set -euo pipefail
root="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
unit="/etc/systemd/system/fast-close-sync-worker.service"

cat >"$unit" <<EOF
[Unit]
Description=Fast Close CRM read-model sync worker (incremental + pipeline reconcile + editedon catch-up every 3 min)
Documentation=file://${root}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
Environment=HOME=/root
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

chmod +x "${root}/scripts/vps-hosting/sync-worker-daemon.sh" 2>/dev/null || true
chmod +x "${root}/scripts/vps-hosting/sync-worker-nightly.sh" 2>/dev/null || true

install_nightly_timer() {
  local service_name="fast-close-sync-worker-nightly"
  local service_unit="/etc/systemd/system/${service_name}.service"
  local timer_unit="/etc/systemd/system/${service_name}.timer"
  cat >"$service_unit" <<UNIT
[Unit]
Description=Fast Close CRM read-model nightly reconcile (editedon catch-up + YTD open scan)
Documentation=file://${root}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${root}
Environment=SYNC_WORKER_INSTALL_ROOT=${root}
EnvironmentFile=-${root}/.env.sync-worker
ExecStart=${root}/scripts/vps-hosting/sync-worker-nightly.sh
StandardOutput=append:${root}/logs/sync-worker-nightly.log
StandardError=append:${root}/logs/sync-worker-nightly.log
UNIT
  cat >"$timer_unit" <<TIMER
[Unit]
Description=Daily Fast Close CRM status reconcile (02:30)

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
TIMER
  chmod 644 "$service_unit" "$timer_unit"
  systemctl daemon-reload
  systemctl enable "${service_name}.timer"
  systemctl restart "${service_name}.timer"
  echo "--- nightly timer ---"
  systemctl --no-pager list-timers "${service_name}.timer" || true
}
install_nightly_timer

# Recover .env.sync-worker if missing (common after install-root path change)
if [[ ! -f "${root}/.env.sync-worker" ]]; then
  echo "==> .env.sync-worker missing at ${root} — searching known locations"
  for candidate in /opt/fast-close-app/.env.sync-worker /opt/wrl/database/fast-close-app/.env.sync-worker; do
    if [[ -f "$candidate" && "$candidate" != "${root}/.env.sync-worker" ]]; then
      cp -a "$candidate" "${root}/.env.sync-worker"
      echo "    Restored from ${candidate}"
      break
    fi
  done
fi
if [[ ! -f "${root}/.env.sync-worker" ]]; then
  echo "ERROR: ${root}/.env.sync-worker is missing on VPS." >&2
  echo "  From your PC (repo root), after creating .env.sync-worker locally:" >&2
  echo "    scp .env.sync-worker ${VPS_HOST:-root@vps}:${root}/.env.sync-worker" >&2
  echo "  Or on VPS: cp ${root}/scripts/vps-hosting/.env.sync-worker.example ${root}/.env.sync-worker" >&2
  exit 1
fi

# Ensure calls_latest_hot.wco exists (idempotent ADD COLUMN IF NOT EXISTS).
if [[ -f "${root}/docs/read-model-phase1-schema/18-calls_hot_wco.sql" ]]; then
  echo "==> Applying WCO hot-column migration (18-calls_hot_wco.sql)"
  if [[ -f "${root}/.env.sync-worker" ]]; then
    set -a
    # shellcheck disable=SC1091
    # Strip CRLF so DATABASE_URL checks work after Windows edits
    source <(sed 's/\r$//' "${root}/.env.sync-worker")
    set +a
  fi
  DATABASE_URL="$(echo -n "${DATABASE_URL:-}" | tr -d '\r' | xargs || true)"
  if [[ -n "${DATABASE_URL}" ]]; then
    cd "${root}"
    DATABASE_URL="${DATABASE_URL}" node -e "
      const {config}=require('dotenv');
      const fs=require('fs');
      const pg=require('pg');
      const sql=fs.readFileSync('docs/read-model-phase1-schema/18-calls_hot_wco.sql','utf8');
      (async()=>{
        const c=new pg.Client({connectionString:process.env.DATABASE_URL});
        await c.connect();
        await c.query(sql);
        const r=await c.query(\"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calls_latest_hot' AND column_name='wco') AS ok\");
        console.log('wco column present:', r.rows[0]?.ok);
        await c.end();
      })().catch((e)=>{ console.error(e); process.exit(1); });
    "
  else
    echo "WARN: DATABASE_URL missing in .env.sync-worker — skip WCO DDL (run npm run db:apply-read-model:vps)"
  fi
fi

systemctl daemon-reload
systemctl restart fast-close-sync-worker
sleep 3
if ! systemctl is-active --quiet fast-close-sync-worker; then
  echo "ERROR: sync worker failed to start — last journal lines:" >&2
  journalctl -u fast-close-sync-worker -n 40 --no-pager >&2 || true
  echo "--- sync-worker.log ---" >&2
  tail -n 40 "${root}/logs/sync-worker.log" 2>/dev/null || true
  exit 1
fi
systemctl --no-pager status fast-close-sync-worker | head -15
echo "---"
tail -n 8 "${root}/logs/sync-worker.log" 2>/dev/null || true
REMOTE

echo ""
echo "==> Deploy done. Verify: npm run sync-worker:status:vps"
echo "    WCO backfill (optional historical): ssh ${VPS_HOST} 'cd ${INSTALL_ROOT} && npm run sync-worker:backfill-wco -- --from 2026-01-01 --to $(date +%Y-%m-%d)'"
