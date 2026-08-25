#!/usr/bin/env bash
# Subcontractor stock reconciliation & emailing - run via cron every 15 minutes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

LOCK_FILE="${INSTALL_ROOT}/logs/subcontractor-stock-cron.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== subcontractor-stock-cron skipped — already running (pid ${lock_pid}) ==="
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.mis-email"
  set +a
else
  echo "FATAL: missing ${INSTALL_ROOT}/.env.mis-email" >&2
  exit 1
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

echo "=== subcontractor-stock-cron start $(date -Iseconds) ==="

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

echo "=== extracting SAP attachments from Maildir ==="
python3 scripts/vps-hosting/extract-sap-attachments.py || echo "WARNING: SAP extraction failed" >&2

npm run subcontractor-stock:cron
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: subcontractor-stock cron exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== subcontractor-stock-cron complete ==="
