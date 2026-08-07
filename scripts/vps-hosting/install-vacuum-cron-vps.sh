#!/usr/bin/env bash
# Deploy and install Saturday night VACUUM FULL cron job to VPS.
#   npm run db:install-vacuum-cron:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/wrl/database/fast-close-app}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Setting up directories on VPS..."
ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/scripts/ops' '${INSTALL_ROOT}/src/lib/vps-cron' '${INSTALL_ROOT}/logs'"

echo "==> Copying script files to VPS..."
scp \
  "${ROOT}/scripts/vps-hosting/vacuum-full-mis-rows.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
scp \
  "${ROOT}/scripts/ops/vacuum-full-tables.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/ops/"
scp \
  "${ROOT}/src/lib/vps-cron/catalog.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/lib/vps-cron/"

echo "==> Configuring package.json and crontab on VPS..."
ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<'REMOTE'
set -euo pipefail
detected_root=$(find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed 's|/scripts/vps-hosting/mis-email-digest.sh||')
root="${detected_root:-${INSTALL_ROOT:-/opt/wrl/database/fast-close-app}}"

# Ensure package.json has the script
if [[ -f "${root}/package.json" ]] && ! grep -q 'db:vacuum-full-mis-rows' "${root}/package.json"; then
  node -e "
    const fs=require('fs');
    const p='${root}/package.json';
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    j.scripts=j.scripts||{};
    j.scripts['db:vacuum-full-mis-rows']='npx tsx scripts/ops/vacuum-full-tables.ts';
    fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
  "
fi

chmod +x "${root}/scripts/vps-hosting/vacuum-full-mis-rows.sh"
line="0 0 * * 0 ${root}/scripts/vps-hosting/vacuum-full-mis-rows.sh >> ${root}/logs/vacuum-full.log 2>&1"

{
  crontab -l 2>/dev/null | grep -v 'vacuum-full-mis-rows.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "$line"
} | crontab -

echo "==> Installed VACUUM FULL cron (Weekly: Saturday Night at 00:00 IST) at root: ${root}"
crontab -l | grep -E 'CRON_TZ|vacuum-full' || true
REMOTE
