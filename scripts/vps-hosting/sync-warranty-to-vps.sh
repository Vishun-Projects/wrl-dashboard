#!/usr/bin/env bash
# Sync warranty-pipeline source to VPS (run from Git Bash; enter SSH passphrase when prompted).
set -euo pipefail

VPS="${VPS:-root@187.127.145.253}"
REMOTE_DIR="${REMOTE_DIR:-/opt/warranty-pipeline}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WP="${ROOT}/warranty-pipeline"

if [[ ! -d "$WP/pipeline" ]]; then
  echo "Missing ${WP}/pipeline" >&2
  exit 1
fi

echo "==> Syncing warranty-pipeline to ${VPS}:${REMOTE_DIR}"

# Core entrypoints + config
scp "${WP}/run_nightly.py" "${VPS}:${REMOTE_DIR}/run_nightly.py"
scp "${WP}/config.py" "${VPS}:${REMOTE_DIR}/config.py"
scp "${WP}/requirements-vps.txt" "${VPS}:${REMOTE_DIR}/requirements-vps.txt"

# Pipeline package (all modules)
scp -r "${WP}/pipeline" "${VPS}:${REMOTE_DIR}/"

# VPS helper scripts
ssh "${VPS}" "mkdir -p ${REMOTE_DIR}/scripts ${REMOTE_DIR}/scripts/vps-hosting"
scp "${WP}/scripts/"*.sh "${VPS}:${REMOTE_DIR}/scripts/"
scp "${ROOT}/scripts/vps-hosting/warranty-nightly.sh" "${VPS}:${REMOTE_DIR}/scripts/vps-hosting/warranty-nightly.sh"
ssh "${VPS}" "chmod +x ${REMOTE_DIR}/scripts/*.sh ${REMOTE_DIR}/scripts/vps-hosting/warranty-nightly.sh"

echo "==> Verifying key files on VPS"
ssh "${VPS}" "grep -E 'CACHE_VERSION|close_playwright_session|_apply_region_focus' \
  ${REMOTE_DIR}/pipeline/run_cache.py \
  ${REMOTE_DIR}/pipeline/crm/browser_session.py \
  ${REMOTE_DIR}/pipeline/images/scan_image.py 2>/dev/null | head -5"

echo ""
echo "Done. Deployed to ${VPS}:${REMOTE_DIR}"
echo "Re-run verify (example):"
echo "  ssh ${VPS} 'cd ${REMOTE_DIR} && . .venv/bin/activate && CRM_REPORT_DATE=21/06/2026 PLAYWRIGHT_BROWSERS_PATH=${REMOTE_DIR}/.playwright-browsers nohup python -u run_nightly.py --fresh-run >> logs/manual-sync-test.log 2>&1 &'"
