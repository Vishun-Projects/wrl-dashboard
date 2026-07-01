#!/usr/bin/env bash
# Nightly YTD hot refresh — catches any rows missed by incremental / pipeline reconcile.
# Installed by setup-sync-worker-daemon.sh as systemd timer (02:30 daily).
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
# YTD fill loads large CRM chunks — default Node ~2GB heap OOMs on VPS (see logs).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

if [[ "${SYNC_WORKER_ENABLED:-}" != "true" ]]; then
  echo "SYNC_WORKER_ENABLED is not true — skipping nightly hot refresh"
  exit 0
fi

echo "=== sync-worker-nightly $(date -Iseconds) TZ=${TZ:-system} ==="
npm run sync-worker:fill-ytd
echo "=== sync-worker-nightly done $(date -Iseconds) ==="
