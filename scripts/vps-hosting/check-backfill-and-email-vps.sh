#!/usr/bin/env bash
# Quick VPS status: historical / transaction-entry backfill + MIS 09:30 email cron.
# Asks for SSH passphrase. Run from Git Bash:
#   bash scripts/vps-hosting/check-backfill-and-email-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"

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

ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
root='${INSTALL_ROOT}'
echo "=== host \$(hostname) root=\$root ==="
echo ""
echo "=== processes ==="
pgrep -af '[c]li.ts backfill-historical' || echo '(no historical backfill)'
pgrep -af '[t]ransaction-entry-backfill|transaction-entry.backfill|cli.ts transaction-entry-backfill' || echo '(no transaction-entry backfill match)'
pgrep -af 'cli.ts transaction-entry' || echo '(no transaction-entry cli)'
pgrep -af 'mis-email|digest' || echo '(no mis-email process)'
echo ""
echo "=== historical log (last 15) ==="
ls -lt "\$root/logs"/backfill-historical-*.log 2>/dev/null | head -3 || true
latest_hist=\$(ls -t "\$root/logs"/backfill-historical-*.log 2>/dev/null | head -1 || true)
if [[ -n "\$latest_hist" ]]; then
  echo "file: \$latest_hist"
  tail -n 15 "\$latest_hist"
fi
echo ""
echo "=== transaction-entry-backfill.log (last 25) ==="
if [[ -f "\$root/logs/transaction-entry-backfill.log" ]]; then
  tail -n 25 "\$root/logs/transaction-entry-backfill.log"
else
  echo '(no log)'
fi
echo ""
echo "=== MIS email cron ==="
crontab -l 2>/dev/null | grep -E 'CRON_TZ|mis-email' || echo '(no mis-email crontab lines)'
echo ""
echo "=== mis-email.lock ==="
if [[ -f "\$root/logs/mis-email.lock" ]]; then
  cat "\$root/logs/mis-email.lock"
  lock_pid=\$(head -1 "\$root/logs/mis-email.lock" 2>/dev/null || true)
  if [[ -n "\$lock_pid" ]] && kill -0 "\$lock_pid" 2>/dev/null; then
    echo "lock pid \$lock_pid is ALIVE"
    ps -fp "\$lock_pid" || true
  else
    echo "lock pid stale or missing process"
  fi
else
  echo '(no lock)'
fi
echo ""
echo "=== mis-email-cron.log around today / last 80 lines ==="
if [[ -f "\$root/logs/mis-email-cron.log" ]]; then
  tail -n 80 "\$root/logs/mis-email-cron.log"
else
  echo '(no mis-email-cron.log)'
fi
echo ""
echo "=== journal / cron for mis-email today (if any) ==="
grep -E 'mis-email|CRON' /var/log/syslog 2>/dev/null | tail -n 20 || true
date -Iseconds
REMOTE
