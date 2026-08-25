#!/usr/bin/env bash
# Install a TEST-only MIS email cron at 14:00 IST → Vishnu only.
# Uses .../current (release layout). Does NOT pin a SHA path.
# Does NOT change / remove the production digest cron (*/15 Mon–Sat).
#
#   npm run mis-email:install-test-cron:vps
#   RUN_NOW=0 npm run mis-email:install-test-cron:vps   # cron only, no immediate send
#
# Optional:
#   MIS_EMAIL_TEST_TO=other@example.com
#   MIS_EMAIL_TEST_CRON_HOUR=14
#   MIS_EMAIL_TEST_CRON_MIN=0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
INSTALL_BASE="${INSTALL_BASE%/current}"
TEST_TO="${MIS_EMAIL_TEST_TO:-vishnu.vishwakarma@westernequipments.com}"
CRON_HOUR="${MIS_EMAIL_TEST_CRON_HOUR:-14}"
CRON_MIN="${MIS_EMAIL_TEST_CRON_MIN:-0}"
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

echo "==> Uploading test digest script into current (strip CRLF)"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/mis-email-test-digest.sh" \
  "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
  "${VPS_HOST}:/tmp/"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
base='${INSTALL_BASE}'
test_to='${TEST_TO}'
hour='${CRON_HOUR}'
min='${CRON_MIN}'

if [[ -e "\${base}/current/scripts/vps-hosting/mis-email-digest.sh" ]]; then
  code="\${base}/current"
else
  echo "ERROR: release layout missing at \${base}/current — run: npm run sync-worker:deploy:vps" >&2
  exit 1
fi
log_dir="\${base}/shared/logs"
mkdir -p "\$log_dir" "\$code/scripts/vps-hosting"

# Strip Windows CRLF so bash does not see pipefail\\r
sed 's/\r$//' /tmp/mis-email-test-digest.sh > "\$code/scripts/vps-hosting/mis-email-test-digest.sh"
sed 's/\r$//' /tmp/vps-cron-gate.sh > "\$code/scripts/vps-hosting/vps-cron-gate.sh"
chmod +x "\$code/scripts/vps-hosting/mis-email-test-digest.sh" \
         "\$code/scripts/vps-hosting/vps-cron-gate.sh"
rm -f /tmp/mis-email-test-digest.sh /tmp/vps-cron-gate.sh

# Env lives in shared/ (symlink into current)
if [[ ! -f "\$code/.env.mis-email" && -f "\${base}/shared/.env.mis-email" ]]; then
  ln -sfn "\${base}/shared/.env.mis-email" "\$code/.env.mis-email"
fi
if [[ ! -f "\$code/.env.mis-email" ]]; then
  echo "ERROR: missing .env.mis-email under current/shared" >&2
  exit 1
fi
test -f "\$code/src/modules/mis-email/services/cli.ts"

echo "==> Installing TEST cron at \${hour}:\${min} IST → \${test_to} (code=\$code)"
# Keep existing prod + watchdog lines; only replace test line
{
  crontab -l 2>/dev/null | grep -v 'mis-email-test-digest.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "\${min} \${hour} * * * MIS_EMAIL_TEST_TO=\${test_to} \${code}/scripts/vps-hosting/mis-email-test-digest.sh >> \${log_dir}/mis-email-test-cron.log 2>&1"
} | awk 'NF && !seen[\$0]++' | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
printf '==> Test schedule: %s:%02d Asia/Kolkata → %s\n' "\$hour" "\$min" "\$test_to"
date -Iseconds

if [[ '${RUN_NOW:-1}' == '1' ]]; then
  echo "==> Running test digest NOW (does not wait for cron)…"
  MIS_EMAIL_TEST_TO="\${test_to}" MIS_EMAIL_INSTALL_ROOT="\$code" \
    bash "\$code/scripts/vps-hosting/mis-email-test-digest.sh" \
    | tee -a "\${log_dir}/mis-email-test-cron.log"
fi
REMOTE

echo ""
echo "Installed. Test mail → ${TEST_TO} at ${CRON_HOUR}:$(printf '%02d' "$CRON_MIN") IST via current."
echo "Production digest cron unchanged."
echo "  ssh ${VPS_HOST} 'tail -n 80 ${INSTALL_BASE}/shared/logs/mis-email-test-cron.log'"
