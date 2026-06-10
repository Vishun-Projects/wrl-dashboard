#!/usr/bin/env bash
# Self-host Supabase on Ubuntu VPS for wrl-fsm.cloud migration.
set -euo pipefail

API_DOMAIN="${API_DOMAIN:-api.wrl-fsm.cloud}"
SITE_URL="${SITE_URL:-https://wrl-dashboard.vercel.app}"
POOLER_TENANT_ID="${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase/docker}"

for var in JWT_SECRET POSTGRES_PASSWORD ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env: $var" >&2
    exit 1
  fi
done

echo "==> Installing Docker (if needed)"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Cloning Supabase Docker stack"
mkdir -p /opt/supabase
if [[ ! -d "$SUPABASE_DIR" ]]; then
  git clone --depth 1 https://github.com/supabase/supabase /opt/supabase
fi

echo "==> Configuring Supabase .env (full .env.example + overrides)"
bash /root/repair-supabase-env.sh 2>/dev/null || bash "$(dirname "$0")/repair-supabase-env.sh"

echo "==> Installing Caddy reverse proxy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
${API_DOMAIN} {
  reverse_proxy localhost:8000
}
EOF
systemctl enable caddy
systemctl reload caddy

echo "==> Firewall"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 6543/tcp
ufw status || true

echo ""
echo "Setup complete. Next: run migrate from your PC (deploy-to-vps.sh migrate)"
