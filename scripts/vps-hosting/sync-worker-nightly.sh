#!/usr/bin/env bash
# Nightly status repair — full YTD editedon replay + stale pipeline/tech_solved reconcile.
# Safer than fill-ytd during MIS close (status-only replay, no full YTD rewrite).
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
  echo "SYNC_WORKER_ENABLED is not true — skipping nightly editedon catch-up"
  exit 0
fi

YTD_START="${SYNC_EDITEDON_CATCHUP_FROM:-$(date +%Y)-01-01}"
TODAY="$(date +%Y-%m-%d)"

echo "=== sync-worker-nightly $(date -Iseconds) TZ=${TZ:-system} ==="
echo "Editedon catch-up ${YTD_START} .. ${TODAY} (addedon <> editedon)"
npm run sync-worker:editedon-catchup -- --from "${YTD_START}" --to "${TODAY}"
npm run sync-worker:pipeline-reconcile
echo "tech_solved -> closed/cancelled refresh"
npm run sync-worker:reconcile-tech-solved -- --apply
echo "Full YTD open/assigned reconcile (transferred + cancelled orphans)"
npm run sync-worker:reconcile-ytd-open -- --apply
echo "Major/minor reconcile (open pipeline + recent fault edits)"
npm run sync-worker:reconcile-major
echo "Sample hot vs CRM mismatch check"
npm run sync-worker:hot-crm-mismatch-sample || echo "WARN: mismatch sample found differences (non-fatal for nightly)"
# Keep WCO filled for the rolling window (day-chunk CRM pull; safe / no truncate).
WCO_FROM="${WCO_BACKFILL_FROM:-${TODAY}}"
# Default: last 3 calendar days (covers late CRM edits + gap days).
if [[ -z "${WCO_BACKFILL_FROM:-}" ]]; then
  if date -d "${TODAY} -2 days" +%Y-%m-%d >/dev/null 2>&1; then
    WCO_FROM="$(date -d "${TODAY} -2 days" +%Y-%m-%d)"
  elif date -v-2d -j -f "%Y-%m-%d" "${TODAY}" +%Y-%m-%d >/dev/null 2>&1; then
    WCO_FROM="$(date -v-2d -j -f "%Y-%m-%d" "${TODAY}" +%Y-%m-%d)"
  fi
fi
echo "WCO backfill ${WCO_FROM} .. ${TODAY}"
npm run sync-worker:backfill-wco -- --from "${WCO_FROM}" --to "${TODAY}" || echo "WARN: WCO backfill failed (non-fatal)"
echo "=== sync-worker-nightly done $(date -Iseconds) ==="
