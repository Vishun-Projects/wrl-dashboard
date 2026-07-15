#!/usr/bin/env bash
# Morning warranty status email — 7 AM (if analytics done) or 9 AM fallback.
#   WARRANTY_REPORT_SLOT=7 bash …/warranty-morning-report.sh
#   WARRANTY_REPORT_SLOT=9 bash …/warranty-morning-report.sh
set -euo pipefail

INSTALL_ROOT="${WARRANTY_INSTALL_ROOT:-/opt/warranty-pipeline}"
cd "$INSTALL_ROOT"

SLOT="${WARRANTY_REPORT_SLOT:-7}"
# Allow: bash warranty-morning-report.sh 9
if [[ "${1:-}" =~ ^(7|9)$ ]]; then
  SLOT="$1"
fi

VENV="${INSTALL_ROOT}/.venv"
PY="${VENV}/bin/python"
if [[ ! -x "$PY" ]]; then
  PY="$(command -v python3)"
fi

export PYTHONPATH="${INSTALL_ROOT}${PYTHONPATH:+:$PYTHONPATH}"
export WARRANTY_REPORT_SLOT="$SLOT"

echo "=== warranty-morning-report slot=${SLOT} $(date -Iseconds) ==="

# Purge generated artifacts older than WARRANTY_RETENTION_DAYS (default 7)
"$PY" "${INSTALL_ROOT}/scripts/cleanup_old_generated.py" || echo "cleanup warning (non-fatal)"

"$PY" "${INSTALL_ROOT}/scripts/send_morning_report.py" --slot="$SLOT"
echo "=== warranty-morning-report done (slot=${SLOT}) ==="
