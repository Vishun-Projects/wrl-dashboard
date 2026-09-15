#!/usr/bin/env bash
# Standalone compressor barcodes sync daemon (runs every 5 min)
# Managed locally or via systemd on VPS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

mkdir -p "${INSTALL_ROOT}/logs"

HOME="${HOME:-/root}"
export HOME
PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  latest_node="$(ls -1 "${HOME}/.nvm/versions/node" 2>/dev/null | tail -1 || true)"
  if [[ -n "${latest_node}" && -d "${HOME}/.nvm/versions/node/${latest_node}/bin" ]]; then
    PATH="${HOME}/.nvm/versions/node/${latest_node}/bin:${PATH}"
  fi
fi
export PATH

export NODE_ENV=production
echo "=== compressor-barcodes-daemon $(date -Iseconds) interval=300s ==="
exec npm run sync-worker:compressor-barcodes:daemon
