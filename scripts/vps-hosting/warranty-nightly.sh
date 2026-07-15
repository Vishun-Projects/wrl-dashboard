#!/usr/bin/env bash
# Nightly warranty pipeline — invoked by cron on VPS at 1 AM IST.
set -euo pipefail

INSTALL_ROOT="${WARRANTY_INSTALL_ROOT:-/opt/warranty-pipeline}"
cd "$INSTALL_ROOT"

export PLAYWRIGHT_HEADED=false
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${INSTALL_ROOT}/.playwright-browsers}"
export NIGHTLY_ROOT="${INSTALL_ROOT}"
# Default 6h — spare-part EasyOCR verify can exceed 3h on busy days.
export NIGHTLY_MAX_RUNTIME_SEC="${NIGHTLY_MAX_RUNTIME_SEC:-21600}"

VENV="${INSTALL_ROOT}/.venv"
if [[ ! -x "${VENV}/bin/python" ]]; then
  echo "Missing venv at ${VENV} — run setup-warranty-nightly.sh first" >&2
  exit 1
fi

PREFLIGHT="${INSTALL_ROOT}/scripts/nightly-preflight.sh"
if [[ ! -x "$PREFLIGHT" ]]; then
  echo "Missing ${PREFLIGHT} — sync warranty-pipeline scripts to VPS" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${VENV}/bin/activate"

mkdir -p "${INSTALL_ROOT}/logs" "${INSTALL_ROOT}/reports/latest" "${INSTALL_ROOT}/cache"

echo "=== warranty-nightly $(date -Iseconds) TZ=${TZ:-system} report_date=${CRM_REPORT_DATE:-yesterday} max_runtime=${NIGHTLY_MAX_RUNTIME_SEC}s ==="

if ! bash "$PREFLIGHT" cron; then
  echo "=== warranty-nightly skipped — another job is still running ==="
  exit 0
fi

set +e
timeout --foreground "${NIGHTLY_MAX_RUNTIME_SEC}" \
  "${VENV}/bin/python" -u "${INSTALL_ROOT}/run_nightly.py"
rc=$?
set -e

if [[ "$rc" -eq 124 ]]; then
  echo "FATAL: nightly exceeded ${NIGHTLY_MAX_RUNTIME_SEC}s — process killed" >&2
  pkill -9 -f '[c]hromium' 2>/dev/null || true
  rm -f "${INSTALL_ROOT}/logs/run_nightly.lock"
  exit 124
fi

# Drop generated data older than WARRANTY_RETENTION_DAYS (default 7)
if [[ "$rc" -eq 0 ]]; then
  "${VENV}/bin/python" "${INSTALL_ROOT}/scripts/cleanup_old_generated.py" \
    || echo "cleanup warning (non-fatal)"
fi

exit "$rc"
