#!/usr/bin/env bash
# VPS setup: large-file MIS upload + register CSV export server.
#
# From Git Bash on your PC (repo root) — NOT on the VPS path itself:
#   npm run mis-upload:setup:vps
# That SSHs to the VPS and runs --local there.
#
# Already on the VPS shell:
#   cd /opt/wrl/database/fast-close-app && bash scripts/vps-hosting/setup-mis-upload-server.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_UPLOAD_INSTALL_ROOT:-/opt/wrl/database/fast-close-app}"
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
Environment=NODE_OPTIONS=--max-old-space-size=4096
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
  local upload_port="${UPLOAD_PORT}"
  echo "==> Ensuring MIS upload/download routes in ${caddyfile}"

  if [[ ! -f "$caddyfile" ]]; then
    cat >"$caddyfile" <<EOF
api.wrl-fsm.cloud {
	handle /api/mis-client-import/upload* {
		request_body {
			max_size 320MB
		}
		reverse_proxy 127.0.0.1:${upload_port}
	}
	handle /api/mis-client-import/batches/*/download {
		reverse_proxy 127.0.0.1:${upload_port}
	}
	handle /api/report/register-export {
		reverse_proxy 127.0.0.1:${upload_port}
	}
	handle /internal/mail* {
		reverse_proxy 127.0.0.1:8789
	}
	reverse_proxy localhost:8000
}
EOF
  else
    if ! grep -Fq 'handle /api/mis-client-import/upload*' "$caddyfile"; then
      if grep -Fq 'handle /api/mis-client-import/upload {' "$caddyfile"; then
        echo "    upgrading upload handle to cover /upload-chunk"
        python3 - "$caddyfile" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = "handle /api/mis-client-import/upload {"
new = "handle /api/mis-client-import/upload* {"
if old in text:
    path.write_text(text.replace(old, new, 1))
    print("    upgraded upload handle → upload*")
PY
      fi
    fi
    if ! grep -Fq 'handle /api/mis-client-import/batches/*/download' "$caddyfile"; then
      echo "    inserting batch download handle"
      python3 - "$caddyfile" "$upload_port" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
port = sys.argv[2]
text = path.read_text()
block = f"""\thandle /api/mis-client-import/batches/*/download {{
\t\treverse_proxy 127.0.0.1:{port}
\t}}
"""
needle = "api.wrl-fsm.cloud {"
idx = text.find(needle)
if idx < 0:
    raise SystemExit("api.wrl-fsm.cloud site block not found in Caddyfile")
insert_at = idx + len(needle)
# Prefer right after upload handle if present
upload_idx = text.find("handle /api/mis-client-import/upload")
if upload_idx > idx:
    # find end of that handle block
    brace = text.find("{", upload_idx)
    depth = 0
    i = brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                insert_at = i + 1
                break
        i += 1
path.write_text(text[:insert_at] + "\n" + block + text[insert_at:])
print("    inserted batches/*/download handle")
PY
    else
      echo "    batch download route already present"
    fi
    if ! grep -Fq 'handle /api/report/register-export' "$caddyfile"; then
      echo "    inserting register-export handle"
      python3 - "$caddyfile" "$upload_port" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
port = sys.argv[2]
text = path.read_text()
block = f"""\thandle /api/report/register-export {{
\t\treverse_proxy 127.0.0.1:{port}
\t}}
"""
needle = "api.wrl-fsm.cloud {"
idx = text.find(needle)
if idx < 0:
    raise SystemExit("api.wrl-fsm.cloud site block not found in Caddyfile")
insert_at = idx + len(needle)
dl_idx = text.find("handle /api/mis-client-import/batches")
if dl_idx > idx:
    brace = text.find("{", dl_idx)
    depth = 0
    i = brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                insert_at = i + 1
                break
        i += 1
path.write_text(text[:insert_at] + "\n" + block + text[insert_at:])
print("    inserted register-export handle")
PY
    else
      echo "    register-export route already present"
    fi
  fi

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
      echo "MIS_UPLOAD_CORS_ORIGINS=https://wrl-dashboard.vercel.app,https://www.wrl-fsm.cloud,https://wrl-fsm.cloud,http://localhost:3000"
      if [[ -f "${root}/.env.vps-setup" ]]; then
        # shellcheck disable=SC1090
        source "${root}/.env.vps-setup"
        echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
        echo "SUPABASE_JWT_SECRET=${JWT_SECRET}"
      elif [[ -f "${ROOT}/.env.vps-setup" ]]; then
        # shellcheck disable=SC1090
        source "${ROOT}/.env.vps-setup"
        echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
        echo "SUPABASE_JWT_SECRET=${JWT_SECRET}"
      fi
    } >"${root}/.env.mis-upload"
    chmod 600 "${root}/.env.mis-upload"
  else
    echo "==> ${root}/.env.mis-upload already exists"
    if ! grep -q '^SUPABASE_JWT_SECRET=.\+' "${root}/.env.mis-upload" 2>/dev/null; then
      echo "WARN: SUPABASE_JWT_SECRET missing/empty — uploads will return Unauthorized" >&2
    fi
    if ! grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\+' "${root}/.env.mis-upload" 2>/dev/null; then
      echo "WARN: SUPABASE_SERVICE_ROLE_KEY missing/empty — token fallback verify will fail" >&2
    fi
  fi

  cd "${root}"
  npm ci 2>/dev/null || npm install

  install_systemd_unit "${root}"
  install_caddy_route

  echo ""
  echo "==> Set on Vercel (Production):"
  echo "    NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL=https://api.wrl-fsm.cloud/api/mis-client-import/upload"
  echo "    MIS_UPLOAD_CORS_ORIGINS=https://wrl-dashboard.vercel.app,https://www.wrl-fsm.cloud,https://wrl-fsm.cloud,http://localhost:3000"
}

if [[ "${1:-}" == "--local" ]]; then
  # Windows scp can leave CRLF → `set: invalid option name`
  if command -v sed >/dev/null 2>&1; then
    sed -i 's/\r$//' "$0" 2>/dev/null || true
  fi
  run_install_on_machine "${INSTALL_ROOT}"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "==> Syncing MIS upload + register CSV export code to VPS (${VPS_HOST})"
ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}'"

# Prefer full tree via git when the VPS checkout exists (includes register-export + audit).
# Deploy checkout only: discard local VPS edits / untracked clutter that block pull. Keeps .env*.
if ssh "$VPS_HOST" "test -d '${INSTALL_ROOT}/.git'"; then
  echo "==> Syncing VPS checkout to origin/main (discards local VPS edits; keeps .env*)"
  ssh "$VPS_HOST" "git config --global --add safe.directory '${INSTALL_ROOT}' 2>/dev/null || true; cd '${INSTALL_ROOT}' && git fetch --all --prune && git reset --hard origin/main && git clean -fd -e '.env*' -e 'node_modules' -e '.cache' -e 'logs' -e '.next'"
else
  echo "==> No .git on VPS — copying required paths"
  ssh "$VPS_HOST" "mkdir -p ${INSTALL_ROOT}/scripts/vps-hosting ${INSTALL_ROOT}/src/modules/mis/client-import/services ${INSTALL_ROOT}/src/lib/auth ${INSTALL_ROOT}/src/modules/mis/register/server ${INSTALL_ROOT}/src/lib/security"
  scp "${ROOT}/scripts/vps-hosting/mis-upload-server.ts" "${ROOT}/scripts/vps-hosting/setup-mis-upload-server.sh" \
    "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
  scp -r "${ROOT}/src/modules/mis/client-import/services/"* "${VPS_HOST}:${INSTALL_ROOT}/src/modules/mis/client-import/services/" 2>/dev/null || true
  scp "${ROOT}/src/lib/auth/user-auth-query.ts" "${ROOT}/src/lib/auth/rbac-catalog.ts" \
    "${ROOT}/src/lib/auth/verify-jwt-core.ts" "${ROOT}/src/lib/auth/app-user-profile.ts" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/auth/" 2>/dev/null || true
  scp "${ROOT}/src/lib/security/audit.ts" "${ROOT}/src/lib/security/audit-labels.ts" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/security/" 2>/dev/null || true
fi

# Always refresh the upload server entrypoints (even after git pull, in case of local edits).
scp "${ROOT}/scripts/vps-hosting/mis-upload-server.ts" "${ROOT}/scripts/vps-hosting/setup-mis-upload-server.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"

ssh "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
ROOT='${INSTALL_ROOT}'
sed -i 's/\r\$//' "\$ROOT/scripts/vps-hosting/setup-mis-upload-server.sh" || true
# Register CSV export reads calls_latest_hot
if [[ -f "\$ROOT/.env.mis-upload" ]] && ! grep -q '^READ_REGISTER_FROM=' "\$ROOT/.env.mis-upload"; then
  echo 'READ_REGISTER_FROM=postgres' >> "\$ROOT/.env.mis-upload"
  echo 'READ_CALLS_FROM=postgres' >> "\$ROOT/.env.mis-upload"
fi
MIS_UPLOAD_INSTALL_ROOT="\$ROOT" bash "\$ROOT/scripts/vps-hosting/setup-mis-upload-server.sh" --local
REMOTE
