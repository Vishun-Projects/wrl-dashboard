#!/usr/bin/env bash
# Purge client-import upload files older than 7 days (rows stay).
# Cron (IST): 15 3 * * * …/mis-client-purge-old-files.sh >> …/mis-client-purge.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-${MIS_UPLOAD_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"
echo "=== mis-client-purge-old-files $(TZ=Asia/Kolkata date -Iseconds) ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"

load_env() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
  return 0
}

BASE_ROOT="${INSTALL_ROOT%/current}"
if [[ -d "${INSTALL_ROOT}/shared" ]]; then
  BASE_ROOT="${INSTALL_ROOT}"
elif [[ -d "${INSTALL_ROOT}/../shared" ]]; then
  BASE_ROOT="$(cd "${INSTALL_ROOT}/.." && pwd)"
elif [[ -d "${INSTALL_ROOT}/../../shared" ]]; then
  BASE_ROOT="$(cd "${INSTALL_ROOT}/../.." && pwd)"
fi
load_env "${INSTALL_ROOT}/.env.mis-upload" \
  || load_env "${BASE_ROOT}/.env.mis-upload" \
  || load_env "${INSTALL_ROOT}/.env.mis-email" \
  || load_env "${BASE_ROOT}/shared/.env.mis-email" \
  || true

if [[ -z "${MIS_CLIENT_IMPORT_DIR:-}" ]]; then
  if [[ -d "${BASE_ROOT}/shared" ]]; then
    export MIS_CLIENT_IMPORT_DIR="${BASE_ROOT}/shared/mis-client-import"
  fi
fi
mkdir -p "${MIS_CLIENT_IMPORT_DIR:-${INSTALL_ROOT}/.cache/mis-client-import}"

vps_cron_gate_allow mis_client_purge || exit 0

export NODE_ENV=production
npm run mis-client:purge-old-files
echo "=== mis-client-purge-old-files complete ==="
