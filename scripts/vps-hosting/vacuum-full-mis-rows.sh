#!/usr/bin/env bash
# Runs VACUUM FULL on mis_client_import_rows to reclaim disk space to the OS.
# Cron (IST): 0 0 * * 0 …/vacuum-full-mis-rows.sh >> …/vacuum-full.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-${MIS_UPLOAD_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"
echo "=== vacuum-full-mis-rows $(TZ=Asia/Kolkata date -Iseconds) ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"

if [[ -f "${INSTALL_ROOT}/.env.mis-upload" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-upload"
  set +a
elif [[ -f "${INSTALL_ROOT}/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.local"
  set +a
fi

vps_cron_gate_allow vacuum_full_mis_rows || exit 0

export NODE_ENV=production
npm run db:vacuum-full-mis-rows
echo "=== vacuum-full-mis-rows complete ==="
