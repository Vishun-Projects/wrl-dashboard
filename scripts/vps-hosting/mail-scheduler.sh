#!/usr/bin/env bash
# Unified mail poller — MIS digest + subcontractor stock (every 15 min IST).
# Replaces separate mis-email-digest.sh + subcontractor-stock-cron.sh crontab lines.
#
# Install (example):
#   */15 * * * * /opt/fast-close-app/current/scripts/vps-hosting/mail-scheduler.sh >> /opt/fast-close-app/logs/mail-scheduler.log 2>&1
#
# Individual scripts remain for manual runs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

LOCK_FILE="${INSTALL_ROOT}/logs/mail-scheduler.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== mail-scheduler skipped — already running (pid ${lock_pid}) ==="
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

echo "=== mail-scheduler $(date -Iseconds) TZ=${TZ:-system} ==="

# MIS digest (Mon–Sat IST; Sunday skip matches mis-email-digest.sh)
if [[ "$(TZ=Asia/Kolkata date +%u)" != "7" ]]; then
  echo "--- MIS email digest ---"
  "${SCRIPT_DIR}/mis-email-digest.sh" || echo "WARN: MIS digest failed" >&2
else
  echo "--- MIS email digest skipped (Sunday IST) ---"
fi

echo "--- Subcontractor stock ---"
"${SCRIPT_DIR}/subcontractor-stock-cron.sh" || echo "WARN: subcontractor stock failed" >&2

echo "=== mail-scheduler complete ==="
