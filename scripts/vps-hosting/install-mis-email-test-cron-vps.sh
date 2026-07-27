#!/usr/bin/env bash
# Install a TEST-only MIS email cron at 14:00 IST → Vishnu only.
# Also syncs src/features/mis-email so the VPS has the cli path the cron needs.
# Does NOT change / remove the production 09:30 digest cron.
#
#   npm run mis-email:install-test-cron:vps
#
# Optional:
#   MIS_EMAIL_TEST_TO=other@example.com
#   MIS_EMAIL_TEST_CRON_HOUR=14
#   MIS_EMAIL_TEST_CRON_MIN=0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
TEST_TO="${MIS_EMAIL_TEST_TO:-vishnu.vishwakarma@westernequipments.com}"
CRON_HOUR="${MIS_EMAIL_TEST_CRON_HOUR:-14}"
CRON_MIN="${MIS_EMAIL_TEST_CRON_MIN:-0}"

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

detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
fi
echo "    host=${VPS_HOST}  root=${INSTALL_ROOT}"

echo "==> Syncing package.json + src/features + src/lib + tsconfig (CLI must not need src/components)"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "mkdir -p '${INSTALL_ROOT}/src/features' '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/logs'"

if command -v rsync >/dev/null 2>&1; then
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/features/" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/features/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/lib/" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/scripts/vps-hosting/mis-email-test-digest.sh" \
    "${ROOT}/scripts/vps-hosting/mis-email-digest.sh" \
    "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
else
  scp "${SSH_OPTS[@]}" \
    "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/"
  tar -C "${ROOT}" -czf - src/features src/lib \
    | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"
  scp "${SSH_OPTS[@]}" \
    "${ROOT}/scripts/vps-hosting/mis-email-test-digest.sh" \
    "${ROOT}/scripts/vps-hosting/mis-email-digest.sh" \
    "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
fi

ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "chmod +x '${INSTALL_ROOT}/scripts/vps-hosting/mis-email-test-digest.sh' '${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh'"

echo "==> Installing TEST cron at ${CRON_HOUR}:${CRON_MIN} IST → ${TEST_TO}"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
root='${INSTALL_ROOT}'
test_to='${TEST_TO}'
hour='${CRON_HOUR}'
min='${CRON_MIN}'
test -f "\$root/src/features/mis-email/lib/cli.ts"
test -f "\$root/.env.mis-email"
# Barrels must stay lib-only (no UI re-exports) so cron does not need src/components.
! grep -q "export \* from './ui/" "\$root/src/features/register/index.ts"
! grep -q "export \* from './ui/" "\$root/src/features/report/index.ts"

prod=\$(crontab -l 2>/dev/null | grep 'mis-email-digest.sh' | grep -v 'mis-email-test' | head -1 || true)
if [[ -z "\$prod" ]]; then
  prod="30 9 * * 1-6 \${root}/scripts/vps-hosting/mis-email-digest.sh >> \${root}/logs/mis-email-cron.log 2>&1"
else
  prod=\$(echo "\$prod" | sed -E 's/^([0-9]+) ([0-9]+) \* \* \*/\1 \2 * * 1-6/')
fi

{
  crontab -l 2>/dev/null \
    | grep -v 'mis-email-digest.sh' \
    | grep -v 'mis-email-test-digest.sh' \
    | grep -v '^CRON_TZ=' \
    || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "\$prod"
  echo "\${min} \${hour} * * * MIS_EMAIL_TEST_TO=\${test_to} \${root}/scripts/vps-hosting/mis-email-test-digest.sh >> \${root}/logs/mis-email-test-cron.log 2>&1"
} | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
printf '==> Test schedule: %s:%02d Asia/Kolkata → %s\n' "\$hour" "\$min" "\$test_to"
date -Iseconds

if [[ '${RUN_NOW:-1}' == '1' ]]; then
  echo "==> Running test digest NOW (does not wait for cron)…"
  MIS_EMAIL_TEST_TO="\${test_to}" bash "\${root}/scripts/vps-hosting/mis-email-test-digest.sh" \
    | tee -a "\${root}/logs/mis-email-test-cron.log"
fi
REMOTE

echo ""
echo "Installed. Test mail goes only to ${TEST_TO} at ${CRON_HOUR}:$(printf '%02d' "$CRON_MIN") IST."
echo "Production 09:30 digest unchanged."
if [[ "${RUN_NOW:-1}" == "1" ]]; then
  echo "A send was also triggered immediately (RUN_NOW=1). Check inbox + log:"
else
  echo "No immediate send (RUN_NOW=0). Wait for cron, or check log after it fires:"
fi
echo "  ssh ${VPS_HOST} 'tail -n 80 ${INSTALL_ROOT}/logs/mis-email-test-cron.log'"
