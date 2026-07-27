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

if [[ -f "${INSTALL_ROOT}/.env.mis-upload" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-upload"
  set +a
elif [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-email"
  set +a
fi

export NODE_ENV=production
npm run mis-client:purge-old-files
echo "=== mis-client-purge-old-files complete ==="
