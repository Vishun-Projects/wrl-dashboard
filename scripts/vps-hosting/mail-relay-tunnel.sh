#!/usr/bin/env bash
# SSH tunnel: local 8789 → VPS mail relay (bypasses corporate firewall blocking api.wrl-fsm.cloud).
# Keep this terminal open while sending MIS email from localhost.
#
#   npm run mail-relay:tunnel
#
# Then in .env.local:
#   VPS_MAIL_RELAY_TUNNEL=true
#   VPS_MAIL_RELAY_URL=http://127.0.0.1:8789
#   VPS_MAIL_RELAY_SECRET=<same as VPS .env.mis-email>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
VPS_HOST="${VPS_SSH_HOST:-}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi
VPS_HOST="${VPS_SSH_HOST:-${VPS_HOST:-root@187.127.145.253}}"

echo "Tunneling localhost:8789 → VPS mail relay (Ctrl+C to stop)"
echo "Host: ${VPS_HOST}"
exec ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -L 8789:127.0.0.1:8789 "$VPS_HOST"
