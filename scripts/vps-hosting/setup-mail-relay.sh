#!/usr/bin/env bash
# Install VPS mail relay (same Postfix as MIS) + Caddy route for Vercel forgot-password.
# From repo root: bash scripts/vps-hosting/setup-mail-relay.sh --remote
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
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

  echo "==> Patching Caddy for ${API_DOMAIN}/internal/mail/* → 127.0.0.1:${RELAY_PORT}"
  cat > /etc/caddy/Caddyfile <<EOF
${API_DOMAIN} {
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
  VPS_HOST="${VPS_HOST:?Set VPS_HOST}"
  tar -C "${ROOT}" -czf - \
    scripts/vps-hosting/mail-relay-server.ts \
    scripts/vps-hosting/setup-mail-relay.sh \
    src/lib/auth/send-password-reset-email.ts \
    src/lib/mis-email/send.ts \
    src/lib/auth/site-url.ts \
    | ssh "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"
  ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' API_DOMAIN='${API_DOMAIN}' bash '${INSTALL_ROOT}/scripts/vps-hosting/setup-mail-relay.sh'"
  exit 0
fi

run_setup "${INSTALL_ROOT}"
