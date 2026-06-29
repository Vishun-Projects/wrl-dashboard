#!/usr/bin/env bash
# VPS setup: large-file MIS upload server (bypasses Vercel 4.5 MB limit).
# From Git Bash (repo root):
#   npm run mis-upload:setup:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_UPLOAD_INSTALL_ROOT:-/opt/fast-close-app}"
SERVICE_NAME="fast-close-mis-upload"
UPLOAD_PORT="${MIS_UPLOAD_PORT:-3099}"

install_systemd_unit() {
  local root="${1:?}"
  local unit="/etc/systemd/system/${SERVICE_NAME}.service"

  echo "==> Installing systemd unit ${unit}"
  cat >"$unit" <<EOF
[Unit]
Description=Fast Close MIS client file upload server (large files)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
Environment=MIS_UPLOAD_PORT=${UPLOAD_PORT}
EnvironmentFile=-${root}/.env.mis-upload
EnvironmentFile=-${root}/.env.mis-email
ExecStart=/usr/bin/npx tsx ${root}/scripts/vps-hosting/mis-upload-server.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  chmod 644 "$unit"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  systemctl --no-pager --full status "${SERVICE_NAME}" || true
}

install_caddy_route() {
  local caddyfile="/etc/caddy/Caddyfile"
  echo "==> Updating ${caddyfile} for large MIS uploads"
  cat >"$caddyfile" <<EOF
api.wrl-fsm.cloud {
	handle /api/mis-client-import/upload {
		request_body {
			max_size 320MB
		}
		reverse_proxy 127.0.0.1:${UPLOAD_PORT}
	}
	reverse_proxy localhost:8000
}
EOF
  if command -v caddy >/dev/null 2>&1; then
    caddy validate --config "$caddyfile"
    systemctl reload caddy
  fi
}

run_install_on_machine() {
  local root="${1:?}"
  echo "==> MIS upload server install at ${root}"

  if [[ ! -f "${root}/.env.mis-email" ]]; then
    echo "FATAL: ${root}/.env.mis-email missing (DATABASE_URL)" >&2
    exit 1
  fi

  if [[ ! -f "${root}/.env.mis-upload" ]]; then
    echo "==> Creating ${root}/.env.mis-upload"
    {
      echo "NEXT_PUBLIC_SUPABASE_URL=https://api.wrl-fsm.cloud"
      echo "MIS_UPLOAD_CORS_ORIGINS=https://wrl-dashboard.vercel.app,http://localhost:3000"
      if [[ -f "${root}/.env.vps-setup" ]]; then
        # shellcheck disable=SC1090
        source "${root}/.env.vps-setup"
        echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
        echo "SUPABASE_JWT_SECRET=${JWT_SECRET}"
      fi
    } >"${root}/.env.mis-upload"
    chmod 600 "${root}/.env.mis-upload"
  fi

  cd "${root}"
  npm ci 2>/dev/null || npm install

  install_systemd_unit "${root}"
  install_caddy_route

  echo ""
  echo "==> Set on Vercel (Production):"
  echo "    NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL=https://api.wrl-fsm.cloud/api/mis-client-import/upload"
  echo "    MIS_UPLOAD_CORS_ORIGINS=https://wrl-dashboard.vercel.app,http://localhost:3000"
}

if [[ "${1:-}" == "--local" ]]; then
  run_install_on_machine "${INSTALL_ROOT}"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "==> Copying repo scripts to VPS"
ssh "$VPS_HOST" "mkdir -p ${INSTALL_ROOT}/scripts/vps-hosting ${INSTALL_ROOT}/src/lib/mis-client-import ${INSTALL_ROOT}/src/lib/auth"
scp "${ROOT}/scripts/vps-hosting/mis-upload-server.ts" "${ROOT}/scripts/vps-hosting/setup-mis-upload-server.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
scp -r "${ROOT}/src/lib/mis-client-import/"* "${VPS_HOST}:${INSTALL_ROOT}/src/lib/mis-client-import/" 2>/dev/null || true
scp "${ROOT}/src/lib/auth/user-auth-query.ts" "${ROOT}/src/lib/auth/rbac-catalog.ts" \
  "${ROOT}/src/lib/auth/verify-jwt-core.ts" "${ROOT}/src/lib/auth/app-user-profile.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/lib/auth/" 2>/dev/null || true

ssh "$VPS_HOST" "MIS_UPLOAD_INSTALL_ROOT='${INSTALL_ROOT}' bash ${INSTALL_ROOT}/scripts/vps-hosting/setup-mis-upload-server.sh --local"
