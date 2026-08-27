#!/usr/bin/env bash
# Install evening ops sequencer cron — 16:00 IST daily → ops status + probe mails.
#
#   npm run mis-email:install-evening-ops:vps
#   RUN_NOW=0 npm run mis-email:install-evening-ops:vps
#
# Optional:
#   EVENING_OPS_TO=other@example.com
#   EVENING_OPS_STEP_SLEEP_MS=30000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
OPS_TO="${EVENING_OPS_TO:-vishnu.vishwakarma@westernequipments.com}"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-detect-base.inc.sh"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
  -i "${SSH_KEY}"
)

if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
  echo "ERROR: need interactive terminal for SSH passphrase." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  eval "$(ssh-agent -s)"
fi
echo "==> Enter SSH key passphrase for ${SSH_KEY}"
ssh-add "$SSH_KEY"

detected=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<DETECT || true
$(vps_ssh_detect_base_script "$INSTALL_BASE")
DETECT
)
if [[ -n "$detected" ]]; then
  INSTALL_BASE="$detected"
fi
echo "    host=${VPS_HOST}  base=${INSTALL_BASE}"

echo "==> Uploading evening-ops scripts into current (strip CRLF)"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/evening-ops-sequencer.sh" \
  "${ROOT}/scripts/vps-hosting/evening-ops-sequencer.ts" \
  "${ROOT}/scripts/vps-hosting/evening-ops-status.ts" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${ROOT}/src/lib/vps-cron/catalog.ts" \
  "${ROOT}/src/modules/mis-email/services/run-digest.ts" \
  "${VPS_HOST}:/tmp/"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
base='${INSTALL_BASE}'
ops_to='${OPS_TO}'

if [[ -e "\${base}/current/package.json" ]]; then
  code="\${base}/current"
else
  echo "ERROR: release layout missing at \${base}/current — run: npm run sync-worker:deploy:vps" >&2
  exit 1
fi
log_dir="\${base}/shared/logs"
mkdir -p "\$log_dir/evening-ops" "\$code/scripts/vps-hosting" "\$code/src/lib/vps-cron" \
  "\$code/src/modules/mis-email/services"

sed 's/\r$//' /tmp/evening-ops-sequencer.sh > "\$code/scripts/vps-hosting/evening-ops-sequencer.sh"
sed 's/\r$//' /tmp/evening-ops-sequencer.ts > "\$code/scripts/vps-hosting/evening-ops-sequencer.ts"
sed 's/\r$//' /tmp/evening-ops-status.ts > "\$code/scripts/vps-hosting/evening-ops-status.ts"
sed 's/\r$//' /tmp/vps-cron-gate.sh > "\$code/scripts/vps-hosting/vps-cron-gate.sh"
sed 's/\r$//' /tmp/catalog.ts > "\$code/src/lib/vps-cron/catalog.ts"
sed 's/\r$//' /tmp/run-digest.ts > "\$code/src/modules/mis-email/services/run-digest.ts"
chmod +x "\$code/scripts/vps-hosting/evening-ops-sequencer.sh" \
         "\$code/scripts/vps-hosting/vps-cron-gate.sh"
rm -f /tmp/evening-ops-sequencer.sh /tmp/evening-ops-sequencer.ts /tmp/evening-ops-status.ts \
      /tmp/vps-cron-gate.sh /tmp/catalog.ts /tmp/run-digest.ts

if [[ ! -f "\$code/.env.mis-email" && -f "\${base}/shared/.env.mis-email" ]]; then
  ln -sfn "\${base}/shared/.env.mis-email" "\$code/.env.mis-email"
fi
if [[ ! -f "\$code/.env.mis-email" ]]; then
  echo "ERROR: missing .env.mis-email under current/shared" >&2
  exit 1
fi

echo "==> Installing evening-ops cron at 16:00 IST → \${ops_to} (code=\$code)"
# Also heal cancelled-call-digest off stale non-/current/ path (breaks after release flip).
{
  crontab -l 2>/dev/null \
    | grep -v 'evening-ops-sequencer.sh' \
    | grep -v 'cancelled-call-digest.sh' \
    | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "*/15 * * * 1-6 \${code}/scripts/vps-hosting/cancelled-call-digest.sh >> \${log_dir}/cancelled-call-digest-cron.log 2>&1"
  echo "0 16 * * * EVENING_OPS_TO=\${ops_to} \${code}/scripts/vps-hosting/evening-ops-sequencer.sh >> \${log_dir}/evening-ops-sequencer.log 2>&1"
} | awk 'NF && !seen[\$0]++' | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|evening-ops|mis-email|nightly-ytd|subcontractor|cancelled' || true
date -Iseconds

if [[ '${RUN_NOW:-0}' == '1' ]]; then
  echo "==> Running evening-ops NOW on VPS (detached; no full midnight recompute — that was OOM exit 137)"
  nohup env EVENING_OPS_TO="\${ops_to}" MIS_EMAIL_INSTALL_ROOT="\$code" \
    EVENING_OPS_STEP_SLEEP_MS="\${EVENING_OPS_STEP_SLEEP_MS:-5000}" \
    bash "\$code/scripts/vps-hosting/evening-ops-sequencer.sh" \
    >> "\${log_dir}/evening-ops-sequencer.log" 2>&1 &
  pid=\$!
  echo "    started pid=\${pid}"
  echo "    waiting up to 8 min for process exit…"
  for _ in \$(seq 1 96); do
    if ! kill -0 "\$pid" 2>/dev/null; then
      break
    fi
    sleep 5
  done
  echo "==> Tail of evening-ops log:"
  tail -n 80 "\${log_dir}/evening-ops-sequencer.log" || true
  if kill -0 "\$pid" 2>/dev/null; then
    echo "WARN: still running (pid=\${pid}). Check: tail -f \${log_dir}/evening-ops-sequencer.log" >&2
    exit 1
  fi
  if ! grep -q '\\[evening-ops\\] status mailed' "\${log_dir}/evening-ops-sequencer.log"; then
    echo "WARN: no status mailed line in log — see tail above" >&2
    exit 1
  fi
fi
REMOTE

echo "==> Done. Cron: 0 16 * * * Asia/Kolkata → ${OPS_TO}"
echo "  ssh ${VPS_HOST} 'tail -n 80 ${INSTALL_BASE}/shared/logs/evening-ops-sequencer.log'"
