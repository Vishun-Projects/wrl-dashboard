#!/usr/bin/env bash
# One-off / scheduled MIS email TEST send — never the full production recipient list.
# Default To: vishnu.vishwakarma@westernequipments.com
#
# Cron (IST): 0 14 * * * …/mis-email-test-digest.sh >> …/mis-email-test-cron.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
cd "$INSTALL_ROOT"

TEST_TO="${MIS_EMAIL_TEST_TO:-vishnu.vishwakarma@westernequipments.com}"
LOCK_FILE="${INSTALL_ROOT}/logs/mis-email-test.lock"
mkdir -p "${INSTALL_ROOT}/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== mis-email-test skipped — already running (pid ${lock_pid}) ==="
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
export MIS_EMAIL_TEST_TO="$TEST_TO"

echo "=== mis-email-test $(date -Iseconds) TZ=${TZ:-system} to=${TEST_TO} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow mis_email_test || exit 0

if [[ ! -f "${INSTALL_ROOT}/src/features/mis-email/services/cli.ts" ]]; then
  echo "FATAL: missing ${INSTALL_ROOT}/src/features/mis-email/services/cli.ts — deploy features first" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

npm run mis-email:test -- --to="${TEST_TO}"
rc=$?

if [[ "$rc" -ne 0 ]]; then
  echo "FATAL: mis-email test exited with code ${rc}" >&2
  exit "$rc"
fi

echo "=== mis-email-test complete ==="
