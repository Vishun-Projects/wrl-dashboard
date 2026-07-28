#!/usr/bin/env bash
# Install VPS mail relay (same Postfix as MIS) + Caddy route for Vercel forgot-password.
# From repo root: bash scripts/vps-hosting/setup-mail-relay.sh --remote
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
# Prefer the live WRL install when present (old default /opt/fast-close-app is often empty).
if [[ -z "${MIS_EMAIL_INSTALL_ROOT:-}" ]]; then
  if [[ -f /opt/wrl/database/fast-close-app/scripts/vps-hosting/mail-relay-server.ts ]]; then
    INSTALL_ROOT=/opt/wrl/database/fast-close-app
  else
    INSTALL_ROOT=/opt/fast-close-app
  fi
else
  INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT}"
fi
API_DOMAIN="${API_DOMAIN:-api.wrl-fsm.cloud}"
SERVICE_NAME="wrl-mail-relay"
RELAY_PORT="${MAIL_RELAY_PORT:-8789}"

run_setup() {
  local root="${1:?}"
  local secret

  if [[ -f "${root}/.env.mis-email" ]] && grep -q '^VPS_MAIL_RELAY_SECRET=' "${root}/.env.mis-email" 2>/dev/null; then
    secret="$(grep '^VPS_MAIL_RELAY_SECRET=' "${root}/.env.mis-email" | cut -d= -f2- | tr -d "'\"")"
  else
    secret="$(openssl rand -hex 24)"
    mkdir -p "${root}"
    echo "VPS_MAIL_RELAY_SECRET=${secret}" >> "${root}/.env.mis-email"
    echo "MAIL_RELAY_PORT=${RELAY_PORT}" >> "${root}/.env.mis-email"
  fi

  echo "==> Mail relay secret (add to Vercel env VPS_MAIL_RELAY_SECRET):"
  echo "    ${secret}"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=WRL mail relay (Postfix — same as MIS reports)
After=network.target postfix.service

[Service]
Type=simple
WorkingDirectory=${root}
EnvironmentFile=-${root}/.env.mis-email
ExecStart=/usr/bin/npx tsx ${root}/scripts/vps-hosting/mail-relay-server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}"

  echo "==> Postfix: allow large MIS attachments (default 10MB is too small for YTD register .xlsx)"
  postconf -e 'message_size_limit = 52428800'
  systemctl reload postfix

  echo "==> Patching Caddy for ${API_DOMAIN}/internal/mail/* → 127.0.0.1:${RELAY_PORT}"
  cat > /etc/caddy/Caddyfile <<EOF
${API_DOMAIN} {
  request_body {
    max_size 64MB
  }
  handle /internal/mail* {
    reverse_proxy 127.0.0.1:${RELAY_PORT}
  }
  reverse_proxy localhost:8000
}
EOF
  systemctl reload caddy

  echo ""
  echo "==> Vercel env (Production):"
  echo "    VPS_MAIL_RELAY_URL=https://${API_DOMAIN}/internal/mail/send"
  echo "    VPS_MAIL_RELAY_SECRET=${secret}"
  echo ""
  echo "==> Test locally on VPS:"
  echo "    curl -s -X POST http://127.0.0.1:${RELAY_PORT}/internal/mail/send \\"
  echo "      -H 'Content-Type: application/json' -H 'X-Mail-Relay-Secret: ${secret}' \\"
  echo "      -d '{\"to\":\"you@example.com\",\"resetLink\":\"https://wrl-dashboard.vercel.app/reset-password\"}'"
}

if [[ "${1:-}" == "--remote" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"
  SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o TCPKeepAlive=yes)

  echo "==> Syncing mail relay + app lib to ${VPS_HOST}:${INSTALL_ROOT}"
  ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/src/lib' '${INSTALL_ROOT}/scripts/vps-hosting'"

  if command -v rsync >/dev/null 2>&1; then
    RSYNC_SSH="ssh ${SSH_OPTS[*]}"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/src/lib/" "${VPS_HOST}:${INSTALL_ROOT}/src/lib/"
    rsync -az -e "$RSYNC_SSH" \
      "${ROOT}/scripts/vps-hosting/mail-relay-server.ts" \
      "${ROOT}/scripts/vps-hosting/setup-mail-relay.sh" \
      "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
  else
    tar -C "${ROOT}" -czf - \
      src/lib \
      scripts/vps-hosting/mail-relay-server.ts \
      scripts/vps-hosting/setup-mail-relay.sh \
      | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"
  fi

  ssh "${SSH_OPTS[@]}" "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' API_DOMAIN='${API_DOMAIN}' bash '${INSTALL_ROOT}/scripts/vps-hosting/setup-mail-relay.sh'"

  echo "==> Verifying /internal/mail/mis-digest-prepared (expect 400, not 404)"
  ssh "${SSH_OPTS[@]}" "$VPS_HOST" "secret=\$(grep '^VPS_MAIL_RELAY_SECRET=' '${INSTALL_ROOT}/.env.mis-email' | cut -d= -f2- | tr -d '\"'); code=\$(curl -s -o /dev/null -w '%{http_code}' -X POST 'http://127.0.0.1:${RELAY_PORT}/internal/mail/mis-digest-prepared' -H 'Content-Type: application/json' -H \"X-Mail-Relay-Secret: \${secret}\" -d '{}'); echo \"    local relay HTTP \${code}\"; if [ \"\${code}\" = '404' ]; then echo 'ERROR: mis-digest-prepared still returns 404' >&2; exit 1; fi"
  exit 0
fi

run_setup "${INSTALL_ROOT}"
