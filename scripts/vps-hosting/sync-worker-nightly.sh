#!/usr/bin/env bash
# Nightly editedon catch-up — replays CRM status edits (addedon <> editedon) for YTD.
# Safer than fill-ytd during MIS close (status-only replay, no full YTD rewrite).
set -euo pipefail

INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-/opt/fast-close-app}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "${INSTALL_ROOT}/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${INSTALL_ROOT}/.env.sync-worker"
  set +a
else
  echo "FATAL: missing ${INSTALL_ROOT}/.env.sync-worker" >&2
  exit 1
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

if [[ "${SYNC_WORKER_ENABLED:-}" != "true" ]]; then
  echo "SYNC_WORKER_ENABLED is not true — skipping nightly editedon catch-up"
  exit 0
fi

YTD_START="${SYNC_EDITEDON_CATCHUP_FROM:-$(date +%Y)-01-01}"
TODAY="$(date +%Y-%m-%d)"

echo "=== sync-worker-nightly $(date -Iseconds) TZ=${TZ:-system} ==="
echo "Editedon catch-up ${YTD_START} .. ${TODAY} (addedon <> editedon)"
npm run sync-worker:editedon-catchup -- --from "${YTD_START}" --to "${TODAY}"
npm run sync-worker:pipeline-reconcile
echo "=== sync-worker-nightly done $(date -Iseconds) ==="
