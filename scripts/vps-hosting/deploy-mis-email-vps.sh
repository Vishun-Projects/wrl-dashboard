#!/usr/bin/env bash
# Deploy MIS email (+ shared sync tree) via git-SHA releases — same as sync-worker deploy.
# Does NOT touch .env.mis-email.
#
#   npm run mis-email:deploy:vps
#   RUN_DIGEST=1 npm run mis-email:deploy:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_DIGEST="${RUN_DIGEST:-0}"

echo "==> MIS email deploy uses the same release pipeline as sync-worker"
bash "${ROOT}/scripts/vps-hosting/sync-worker-deploy-vps.sh"

if [[ "$RUN_DIGEST" == "1" ]]; then
  ENV_FILE="${ROOT}/.env.vps-setup"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"
  INSTALL_BASE="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
  INSTALL_BASE="${INSTALL_BASE%/current}"
  echo "==> Running today's digest via current…"
  ssh "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
base='${INSTALL_BASE}'
if [[ -L "\${base}/current" || -d "\${base}/current" ]]; then
  code="\${base}/current"
else
  code="\$base"
fi
bash "\${code}/scripts/vps-hosting/mis-email-digest.sh"
REMOTE
fi

echo ""
echo "Deployed via release current. Next */15 Mon–Sat IST cron tick should use this code."
echo "Send now: RUN_DIGEST=1 npm run mis-email:deploy:vps"
echo "Rollback: npm run sync-worker:rollback:vps"
