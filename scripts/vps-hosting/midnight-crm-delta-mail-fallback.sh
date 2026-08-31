#!/usr/bin/env bash
# Safety net only — mail if verify marker exists and mail not sent. Never mail without verify.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
TODAY="$(TZ=Asia/Kolkata date +%F)"

if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
  AS_OF="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
else
  AS_OF="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
fi

MARKER="${INSTALL_ROOT}/shared/logs/midnight-crm-delta-mailed-${TODAY}"
VERIFY_OK="${INSTALL_ROOT}/shared/logs/midnight-crm-verify-ok-${AS_OF}"

if [[ -f "$MARKER" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback — mail already sent"
  exit 0
fi

if [[ ! -f "$VERIFY_OK" ]]; then
  echo "[$(TZ=Asia/Kolkata date -Iseconds)] SKIP fallback mail — verify marker missing (${VERIFY_OK})"
  echo "FATAL: sync/verify did not complete — no mail sent" >&2
  exit 1
fi

echo "[$(TZ=Asia/Kolkata date -Iseconds)] FALLBACK mail — verify OK, sending CRM delta"
exec bash "${SCRIPT_DIR}/midnight-crm-delta-mail.sh"
