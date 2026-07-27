#!/usr/bin/env bash
# MIS email digest scheduler — run via cron Mon–Sat 09:30 IST (no Sunday).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

# Belt-and-suspenders if cron still has * * * (0=Sun in cron, %u=7 is Sunday).
if [[ "$(TZ=Asia/Kolkata date +%u)" == "7" ]]; then
  echo "=== mis-email-digest skipped — Sunday (IST) ==="
  exit 0
fi

LOCK_FILE="${INSTALL_ROOT}/logs/mis-email.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== mis-email-digest skipped — already running (pid ${lock_pid}) ==="
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
# USE_DIRECT_DATABASE comes from .env.mis-email (false for VPS pooler)

echo "=== mis-email-digest $(date -Iseconds) TZ=${TZ:-system} ==="

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

npm run mis-email:digest
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: mis-email digest exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== mis-email-digest complete ==="
