#!/usr/bin/env bash
# Push sync-worker (+ MIS scripts) to VPS as an immutable git-SHA release, then
# atomically flip /opt/fast-close-app/current. Keeps last 5 releases for rollback.
#
#   npm run sync-worker:deploy:vps
#
# Requires: .env.vps-setup with VPS_HOST, SSH key with access to VPS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_BASE="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
# Strip trailing /current if someone passes the code root by mistake
INSTALL_BASE="${INSTALL_BASE%/current}"

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

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: ${ROOT} is not a git repo — need a SHA for release deploys" >&2
  exit 1
fi

SHA="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
if [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null || true)" ]]; then
  SHA="${SHA}-dirty"
  echo "==> Working tree dirty — release id: ${SHA}"
else
  echo "==> Release SHA: ${SHA}"
fi

echo "==> Detecting install base on VPS..."
# Prefer existing current layout; fall back to flat tree / default
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"
detected_base=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<DETECT || true
$(vps_ssh_detect_base_script "$INSTALL_BASE")
DETECT
)
if [[ -n "$detected_base" ]]; then
  INSTALL_BASE="$detected_base"
fi
echo "    Base: ${INSTALL_BASE}"
RELEASE_DIR="${INSTALL_BASE}/releases/${SHA}"

echo "==> Uploading release helpers"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/vps-release-lib.sh" \
  "${VPS_HOST}:/tmp/vps-release-lib.sh"

echo "==> Ensuring release layout (one-time migrate if flat)"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
# shellcheck disable=SC1091
source /tmp/vps-release-lib.sh
vps_migrate_flat_to_releases '${INSTALL_BASE}'
mkdir -p '${INSTALL_BASE}/releases' '${INSTALL_BASE}/shared/logs'
REMOTE

# Seed shared env once (never overwrite)
if [[ -f "${ROOT}/.env.sync-worker" ]]; then
  remote_has_env=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
    "if test -f '${INSTALL_BASE}/shared/.env.sync-worker' || test -f '${INSTALL_BASE}/.env.sync-worker'; then echo yes; else echo no; fi")
  if [[ "$remote_has_env" == "no" ]]; then
    echo "==> Uploading .env.sync-worker → shared/ (missing on VPS)"
    scp "${SSH_OPTS[@]}" "${ROOT}/.env.sync-worker" "${VPS_HOST}:${INSTALL_BASE}/shared/.env.sync-worker"
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" "chmod 600 '${INSTALL_BASE}/shared/.env.sync-worker'"
  else
    echo "==> Keeping existing VPS .env.sync-worker"
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<ENVFIX
set -euo pipefail
base='${INSTALL_BASE}'
if [[ -f "\${base}/.env.sync-worker" && ! -f "\${base}/shared/.env.sync-worker" ]]; then
  mkdir -p "\${base}/shared"
  mv "\${base}/.env.sync-worker" "\${base}/shared/.env.sync-worker"
fi
ENVFIX
  fi
fi

# Skip re-upload for clean SHA that already exists
remote_exists=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "test -d '${RELEASE_DIR}' && test '${SHA}' = '${SHA%-dirty}' && echo yes || echo no")
if [[ "$remote_exists" == "yes" ]]; then
  echo "==> Release ${SHA} already on VPS — skip upload, will activate"
else
  echo "==> Uploading code → ${RELEASE_DIR}"
  ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
    "rm -rf '${RELEASE_DIR}' && mkdir -p '${RELEASE_DIR}/src/lib' '${RELEASE_DIR}/src/modules' '${RELEASE_DIR}/src/sql' '${RELEASE_DIR}/scripts/vps-hosting' '${RELEASE_DIR}/docs/read-model-phase1-schema'"

  if command -v rsync >/dev/null 2>&1; then
    RSYNC_SSH="ssh ${SSH_OPTS[*]}"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/src/lib/" "${VPS_HOST}:${RELEASE_DIR}/src/lib/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/src/modules/" "${VPS_HOST}:${RELEASE_DIR}/src/modules/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/src/sql/" "${VPS_HOST}:${RELEASE_DIR}/src/sql/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
      "${VPS_HOST}:${RELEASE_DIR}/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/docs/read-model-phase1-schema/" \
      "${VPS_HOST}:${RELEASE_DIR}/docs/read-model-phase1-schema/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/scripts/" "${VPS_HOST}:${RELEASE_DIR}/scripts/"
  else
    echo "    (rsync not found — streaming via tar)"
    tar -C "${ROOT}" -czf - \
      src/lib \
      src/modules \
      src/sql \
      package.json \
      package-lock.json \
      tsconfig.json \
      docs/read-model-phase1-schema \
      scripts \
      | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tar -xzf - -C '${RELEASE_DIR}'"
  fi
fi

echo "==> Link shared + preflight + activate ${SHA}"
ALERT_TO="${SYNC_WORKER_ALERT_TO:-vishunvishwakarma90211@gmail.com}"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "INSTALL_BASE='${INSTALL_BASE}' SHA='${SHA}' SYNC_WORKER_ALERT_TO='${ALERT_TO}' bash -s" <<'REMOTE'
set -euo pipefail
# shellcheck disable=SC1091
source /tmp/vps-release-lib.sh

base="${INSTALL_BASE:?}"
sha="${SHA:?}"
alert_to="${SYNC_WORKER_ALERT_TO:-vishunvishwakarma90211@gmail.com}"
rel="${base}/releases/${sha}"
stamp="$(TZ=Asia/Kolkata date -Iseconds)"
today="$(TZ=Asia/Kolkata date +%F)"

vps_link_shared_into_release "$base" "$rel"

# Recover shared env from known locations
if [[ ! -f "${base}/shared/.env.sync-worker" ]]; then
  for candidate in \
    "${base}/.env.sync-worker" \
    /opt/fast-close-app/.env.sync-worker \
    /opt/wrl/database/fast-close-app/.env.sync-worker; do
    if [[ -f "$candidate" ]]; then
      mkdir -p "${base}/shared"
      cp -a "$candidate" "${base}/shared/.env.sync-worker"
      echo "    Restored .env.sync-worker from ${candidate}"
      vps_link_shared_into_release "$base" "$rel"
      break
    fi
  done
fi
if [[ ! -f "${base}/shared/.env.sync-worker" && ! -f "${rel}/.env.sync-worker" ]]; then
  echo "ERROR: ${base}/shared/.env.sync-worker is missing on VPS." >&2
  exit 1
fi

# Ensure shared node_modules exists (symlink target)
if [[ ! -d "${base}/shared/node_modules" ]]; then
  echo "==> shared/node_modules missing — npm ci in shared (one-time)"
  if [[ -f "${rel}/package.json" ]]; then
    cp -a "${rel}/package.json" "${rel}/package-lock.json" "${base}/shared/" 2>/dev/null || \
      cp -a "${rel}/package.json" "${base}/shared/"
    cd "${base}/shared"
    npm ci 2>/dev/null || npm install
    vps_link_shared_into_release "$base" "$rel"
  fi
fi

# Idempotent WCO column (DDL — not undone by code rollback)
if [[ -f "${rel}/docs/read-model-phase1-schema/18-calls_hot_wco.sql" ]]; then
  echo "==> Applying WCO hot-column migration (18-calls_hot_wco.sql)"
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${base}/shared/.env.sync-worker")
  set +a
  DATABASE_URL="$(echo -n "${DATABASE_URL:-}" | tr -d '\r' | xargs || true)"
  if [[ -n "${DATABASE_URL}" ]]; then
    cd "$rel"
    DATABASE_URL="${DATABASE_URL}" node -e "
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
    echo "WARN: DATABASE_URL missing — skip WCO DDL"
  fi
fi

# Nightly timer unit (paths via current after activate)
install_nightly_timer() {
  local code="${base}/current"
  local service_name="fast-close-sync-worker-nightly"
  local service_unit="/etc/systemd/system/${service_name}.service"
  local timer_unit="/etc/systemd/system/${service_name}.timer"
  cat >"$service_unit" <<UNIT
[Unit]
Description=Fast Close CRM read-model nightly reconcile (editedon catch-up + YTD open scan)
Documentation=file://${code}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${code}
Environment=SYNC_WORKER_INSTALL_ROOT=${code}
EnvironmentFile=-${base}/shared/.env.sync-worker
EnvironmentFile=-${code}/.env.sync-worker
ExecStart=${code}/scripts/vps-hosting/sync-worker-nightly.sh
StandardOutput=append:${base}/shared/logs/sync-worker-nightly.log
StandardError=append:${base}/shared/logs/sync-worker-nightly.log
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
  systemctl restart "${service_name}.timer" || true
}
# Install timer skeleton before activate so rewrite can refresh paths
install_nightly_timer

echo "==> Preflight on release ${sha} (before flipping current)"
cd "$rel"
set +e
preflight_out="$(npx tsx src/lib/read-model/cli.ts help 2>&1)"
preflight_rc=$?
set -e
if [[ "$preflight_rc" -ne 0 ]]; then
  echo "ERROR: deploy preflight failed — NOT activating release" >&2
  echo "$preflight_out" | tail -n 40 >&2
  if [[ -f "${rel}/scripts/vps-hosting/send-vps-ops-alert.ts" ]]; then
    VPS_OPS_ALERT_TO="${alert_to}" \
      VPS_OPS_ALERT_SUBJECT="Update to call sync was stopped — ${today}" \
      VPS_OPS_ALERT_BODY="Hello,

An update to the call sync service was started on the server, but a safety check failed, so the old working version was left running.

When: ${stamp} (India time)
Failed release: ${sha}

What this means:
  • We did not flip current to the broken release.
  • Morning MIS and dashboard should keep using the previous version for now.

What to do:
  1. Fix the incomplete update and try again.
  2. From your PC run: npm run sync-worker:deploy:vps

— WRL server monitoring
" \
      npx tsx "${rel}/scripts/vps-hosting/send-vps-ops-alert.ts" || true
  fi
  exit 1
fi
echo "    preflight ok"

vps_activate_release "$base" "$sha"
vps_prune_releases "$base" 5
install_nightly_timer

code="${base}/current"
systemctl daemon-reload
systemctl restart fast-close-sync-worker
sleep 3
if ! systemctl is-active --quiet fast-close-sync-worker; then
  echo "ERROR: sync worker failed to start — rolling back to previous" >&2
  journalctl -u fast-close-sync-worker -n 40 --no-pager >&2 || true
  tail -n 40 "${base}/shared/logs/sync-worker.log" 2>/dev/null || true
  vps_rollback_to "$base" || true
  systemctl daemon-reload
  systemctl restart fast-close-sync-worker || true
  if [[ -f "${code}/scripts/vps-hosting/send-vps-ops-alert.ts" ]] || [[ -f "${rel}/scripts/vps-hosting/send-vps-ops-alert.ts" ]]; then
    alert_script="${code}/scripts/vps-hosting/send-vps-ops-alert.ts"
    [[ -f "$alert_script" ]] || alert_script="${rel}/scripts/vps-hosting/send-vps-ops-alert.ts"
    VPS_OPS_ALERT_TO="${alert_to}" \
      VPS_OPS_ALERT_SUBJECT="Call sync did not start after update — rolled back — ${today}" \
      VPS_OPS_ALERT_BODY="Hello,

An update (release ${sha}) was applied, but the service did not stay running. The server was rolled back to the previous release.

When: ${stamp} (India time)

What to do:
  1. npm run sync-worker:status:vps
  2. Fix and redeploy: npm run sync-worker:deploy:vps

— WRL server monitoring
" \
      npx tsx "$alert_script" || true
  fi
  exit 1
fi

echo "==> current=$(readlink -f "${base}/current")"
echo "==> previous=$(readlink "${base}/previous" 2>/dev/null || echo '?')"
systemctl --no-pager status fast-close-sync-worker | head -15
echo "---"
tail -n 8 "${base}/shared/logs/sync-worker.log" 2>/dev/null || true

if [[ -f "${code}/scripts/vps-hosting/send-vps-ops-alert.ts" ]]; then
  watermark="$(
    docker exec supabase-db psql -U postgres postgres -At -c \
      "SELECT coalesce(last_editedon::text,'?') FROM sync_state WHERE entity='calls_latest_hot' LIMIT 1;" 2>/dev/null || echo '?'
  )"
  VPS_OPS_ALERT_TO="${alert_to}" \
    VPS_OPS_ALERT_SUBJECT="Call sync was updated on the server — ${today}" \
    VPS_OPS_ALERT_BODY="Hello,

The call sync service on the VPS was updated and restarted successfully.

When: ${stamp} (India time)
Release: ${sha}
Last time call data was synced: ${watermark}

What changed:
  • The programs that copy call updates from CRM into our reports database
  • Related helpers used by MIS, register, and overnight cleanup jobs

Rollback if needed:
  npm run sync-worker:rollback:vps
  SHA=${sha} is current; previous remains available.

— WRL server monitoring
" \
    npx tsx "${code}/scripts/vps-hosting/send-vps-ops-alert.ts" || echo "WARN: post-deploy mail failed"
fi
REMOTE

echo ""
echo "==> Deploy done. SHA=${SHA}  Verify: npm run sync-worker:status:vps"
echo "    Rollback last: npm run sync-worker:rollback:vps"
echo "    Rollback to SHA: SHA=${SHA} npm run sync-worker:rollback:vps"
