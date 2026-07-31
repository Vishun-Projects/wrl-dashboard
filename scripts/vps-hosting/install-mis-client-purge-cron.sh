#!/usr/bin/env bash
# Install daily 03:15 IST cron to purge client-import files older than 7 days.
# Keeps existing crontab lines (MIS email, etc.).
#   npm run mis-client:install-purge-cron:vps
#   bash scripts/vps-hosting/install-mis-client-purge-cron.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/wrl/database/fast-close-app}"

rewrite_crontab() {
  local root="${1}"
  local line="15 3 * * * ${root}/scripts/vps-hosting/mis-client-purge-old-files.sh >> ${root}/logs/mis-client-purge.log 2>&1"
  chmod +x "${root}/scripts/vps-hosting/mis-client-purge-old-files.sh" 2>/dev/null || true
  mkdir -p "${root}/logs"
  {
    crontab -l 2>/dev/null | grep -v 'mis-client-purge-old-files.sh' | grep -v '^CRON_TZ=' || true
    echo "CRON_TZ=Asia/Kolkata"
    echo "$line"
  } | crontab -
  echo "==> Installed client-import file purge cron (daily 03:15 IST, retention 7 days) at ${root}"
  crontab -l | grep -E 'CRON_TZ|mis-client-purge|mis-email-digest' || true
}

if [[ "${1:-}" == "--local" ]]; then
  rewrite_crontab "${MIS_EMAIL_INSTALL_ROOT:-$ROOT}"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting' '${INSTALL_ROOT}/scripts/mis-client' '${INSTALL_ROOT}/src/features/mis-import/services' '${INSTALL_ROOT}/logs'"

scp \
  "${ROOT}/scripts/vps-hosting/mis-client-purge-old-files.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/mis-client-purge-old-files.sh"
scp \
  "${ROOT}/scripts/mis-client/purge-old-import-files.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/mis-client/purge-old-import-files.ts"
scp \
  "${ROOT}/src/features/mis-import/services/purge-old-files.ts" \
  "${ROOT}/src/features/mis-import/services/file-store.ts" \
  "${ROOT}/src/features/mis-import/server.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/features/mis-import/"

# lib files land in feature root from last scp — move into lib/
ssh "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
root='${INSTALL_ROOT}'
detected=\$(find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed 's|/scripts/vps-hosting/mis-email-digest.sh||')
if [[ -n "\$detected" ]]; then root="\$detected"; fi

# Fix scp target: files may be under feature root if path was truncated — ensure lib has them
for f in purge-old-files.ts file-store.ts; do
  if [[ -f "\${root}/src/features/mis-import/\$f" && ! -f "\${root}/src/features/mis-import/services/\$f" ]]; then
    mv "\${root}/src/features/mis-import/\$f" "\${root}/src/features/mis-import/services/\$f"
  fi
done
# Prefer explicit lib paths from a second copy if needed
REMOTE

# Re-scp lib files to the correct lib/ path (avoid the mv dance)
scp \
  "${ROOT}/src/features/mis-import/services/purge-old-files.ts" \
  "${ROOT}/src/features/mis-import/services/file-store.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/features/mis-import/services/"
scp \
  "${ROOT}/src/features/mis-import/server.ts" \
  "${VPS_HOST}:${INSTALL_ROOT}/src/features/mis-import/server.ts"

# package.json script must exist on VPS
ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<'REMOTE'
set -euo pipefail
detected_root=$(find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed 's|/scripts/vps-hosting/mis-email-digest.sh||')
root="${detected_root:-${INSTALL_ROOT:-/opt/wrl/database/fast-close-app}}"

if [[ -f "${root}/package.json" ]] && ! grep -q 'mis-client:purge-old-files' "${root}/package.json"; then
  node -e "
    const fs=require('fs');
    const p='${root}/package.json';
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    j.scripts=j.scripts||{};
    j.scripts['mis-client:purge-old-files']='npx tsx scripts/mis-client/purge-old-import-files.ts';
    fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
  "
fi

chmod +x "${root}/scripts/vps-hosting/mis-client-purge-old-files.sh"
line="15 3 * * * ${root}/scripts/vps-hosting/mis-client-purge-old-files.sh >> ${root}/logs/mis-client-purge.log 2>&1"
{
  crontab -l 2>/dev/null | grep -v 'mis-client-purge-old-files.sh' | grep -v '^CRON_TZ=' || true
  echo "CRON_TZ=Asia/Kolkata"
  echo "$line"
} | crontab -

echo "==> Installed client-import file purge cron (daily 03:15 IST, retention 7 days) at root: ${root}"
crontab -l | grep -E 'CRON_TZ|mis-client-purge|mis-email' || true
REMOTE
