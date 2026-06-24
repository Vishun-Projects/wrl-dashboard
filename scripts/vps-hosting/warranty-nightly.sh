#!/usr/bin/env bash
# Nightly warranty pipeline — invoked by cron on VPS at 1 AM IST.
set -euo pipefail

INSTALL_ROOT="${WARRANTY_INSTALL_ROOT:-/opt/warranty-pipeline}"
cd "$INSTALL_ROOT"

export PLAYWRIGHT_HEADED=false
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${INSTALL_ROOT}/.playwright-browsers}"
# .env is loaded by config.py via python-dotenv (bash source breaks on spaced values)

VENV="${INSTALL_ROOT}/.venv"
if [[ ! -x "${VENV}/bin/python" ]]; then
  echo "Missing venv at ${VENV} — run setup-warranty-nightly.sh first" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${VENV}/bin/activate"

mkdir -p "${INSTALL_ROOT}/logs" "${INSTALL_ROOT}/reports/latest" "${INSTALL_ROOT}/cache"

echo "=== warranty-nightly $(date -Iseconds) TZ=${TZ:-system} report_date=${CRM_REPORT_DATE:-yesterday} ==="

exec "${VENV}/bin/python" "${INSTALL_ROOT}/run_nightly.py"
