#!/usr/bin/env bash
# Nightly non-calls jobs — Athena / attendance / user-locations (02:30 IST).
# Calls (trhcalls → hot) sync once at midnight via midnight-calls-sync.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "${INSTALL_ROOT}/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/.env.sync-worker")
  set +a
else
  echo "FATAL: missing ${INSTALL_ROOT}/.env.sync-worker" >&2
  exit 1
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

SYNC_WORKER_ENABLED="$(echo -n "${SYNC_WORKER_ENABLED:-}" | tr -d '\r' | xargs)"
if [[ "${SYNC_WORKER_ENABLED}" != "true" ]]; then
  echo "SYNC_WORKER_ENABLED is not true — skipping nightly non-calls jobs"
  exit 0
fi

echo "=== sync-worker-nightly (non-calls) $(date -Iseconds) TZ=${TZ:-system} ==="
echo "Calls hot sync runs at 00:00 IST only (midnight-calls-sync.sh) — skipped here."

echo "Athena failed calls incremental sync + reconcile"
npm run sync-worker:athena-sync || echo "WARN: Athena sync failed (non-fatal)"
echo "Attendance details (uv_rptattandenceDetails_New2) watermark + 2d overlap"
if pgrep -f 'attendance-details/run.ts' >/dev/null 2>&1; then
  echo "SKIP attendance — backfill already running (do not start a second CRM pull)"
else
  npm run sync-worker:attendance-sync || echo "WARN: Attendance sync failed (non-fatal)"
fi
echo "User locations (msduserlocation) watermark + 2d overlap"
if pgrep -f 'user-locations/run.ts' >/dev/null 2>&1; then
  echo "SKIP user-locations — sync already running"
else
  npm run sync-worker:user-locations-sync || echo "WARN: User locations sync failed (non-fatal)"
fi
echo "=== sync-worker-nightly done $(date -Iseconds) ==="
