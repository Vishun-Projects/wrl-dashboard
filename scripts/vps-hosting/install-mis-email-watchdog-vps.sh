#!/usr/bin/env bash
# Install morning MIS watchdog cron (09:50 IST) + fix Postfix bounce loop.
# Asks for SSH passphrase. Keeps existing prod digest line + any test cron lines.
#
#   npm run mis-email:install-watchdog:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
ALERT_TO="${MIS_EMAIL_WATCHDOG_TO:-vishnu.vishwakarma@westernequipments.com}"

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

echo "==> Syncing watchdog + postfix bounce fix…"
scp "${SSH_OPTS[@]}" \
  "${ROOT}/scripts/vps-hosting/mis-email-morning-watchdog.sh" \
  "${ROOT}/scripts/vps-hosting/fix-postfix-bounce-loop.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
root='${INSTALL_ROOT}'
alert_to='${ALERT_TO}'
chmod +x "\$root/scripts/vps-hosting/mis-email-morning-watchdog.sh" \
         "\$root/scripts/vps-hosting/fix-postfix-bounce-loop.sh"

echo "==> Fixing Postfix bounce loop (connection refused to public :25)"
MAIL_DOMAIN=wrl-fsm.cloud bash "\$root/scripts/vps-hosting/fix-postfix-bounce-loop.sh"

echo "==> Installing watchdog cron 09:50 IST → \$alert_to"
prod=\$(crontab -l 2>/dev/null | grep 'mis-email-digest.sh' | grep -v test | grep -v watchdog | head -1 || true)
test=\$(crontab -l 2>/dev/null | grep 'mis-email-test-digest.sh' | head -1 || true)
if [[ -z "\$prod" ]]; then
  prod="*/15 * * * 1-6 \${root}/scripts/vps-hosting/mis-email-digest.sh >> \${root}/logs/mis-email-cron.log 2>&1"
else
  # Ensure existing prod line skips Sunday even if older crontab said * * *
  prod=\$(echo "\$prod" | sed -E 's/^([*0-9\/]+) ([*0-9]+) \* \* \*/\1 \2 * * 1-6/')
fi
{
  echo "CRON_TZ=Asia/Kolkata"
  echo "\$prod"
  [[ -n "\$test" ]] && echo "\$test"
  echo "50 9 * * 1-6 MIS_EMAIL_WATCHDOG_TO=\${alert_to} \${root}/scripts/vps-hosting/mis-email-morning-watchdog.sh >> \${root}/logs/mis-email-watchdog.log 2>&1"
} | crontab -

echo "==> Crontab now:"
crontab -l | grep -E 'CRON_TZ|mis-email' || true
REMOTE

echo ""
echo "Installed."
echo "  */15 Mon–Sat IST — production MIS digest (schedule from portal; no Sunday)"
echo "  09:50 IST Mon–Sat — watchdog: emails ${ALERT_TO} ONLY if morning digest failed"
echo "  Postfix bounce loop cleared (those 'connection refused' lines were root@ junk, not MIS)."
