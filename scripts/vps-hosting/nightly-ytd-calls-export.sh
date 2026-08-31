#!/usr/bin/env bash
# Midnight calls sync — 00:00 IST start, full Jan→yesterday, verify 3× vs CRM, mail only after 03:00.
#
# Cron: 0 0 * * * …/nightly-ytd-calls-export.sh >> …/nightly-ytd-export-cron.log
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
  cd "${INSTALL_ROOT}/current"
else
  cd "$INSTALL_ROOT"
fi

LOCK_FILE="${INSTALL_ROOT}/shared/logs/midnight-crm-delta.lock"
mkdir -p "${INSTALL_ROOT}/logs" "${INSTALL_ROOT}/shared/logs"

if [[ -f "$LOCK_FILE" ]]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "=== midnight-calls-sync skipped — already running (pid ${lock_pid}) ==="
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if [[ -f "${INSTALL_ROOT}/shared/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/shared/.env.sync-worker")
  set +a
elif [[ -f "${INSTALL_ROOT}/.env.mis-email" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/.env.mis-email")
  set +a
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export TZ="${TZ:-Asia/Kolkata}"

IST_TODAY="$(TZ=Asia/Kolkata date +%Y-%m-%d)"
if [[ -z "${MIDNIGHT_SYNC_AS_OF:-}" ]]; then
  if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
    MIDNIGHT_SYNC_AS_OF="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
  else
    MIDNIGHT_SYNC_AS_OF="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
  fi
fi
export MIDNIGHT_SYNC_AS_OF
AS_OF="$MIDNIGHT_SYNC_AS_OF"

STATE_DIR="${INSTALL_ROOT}/shared/logs/midnight-sync"
STATE_FILE="${STATE_DIR}/state-${AS_OF}.env"

echo "=== midnight-crm-delta sync-only $(TZ=Asia/Kolkata date -Iseconds) AS_OF=${AS_OF} TZ=${TZ:-system} ==="

# shellcheck source=vps-cron-gate.sh
source "${SCRIPT_DIR}/vps-cron-gate.sh"
vps_cron_gate_allow nightly_ytd_calls_export || exit 0

if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not found on PATH" >&2
  exit 1
fi

DEADLINE_HOUR="${MIDNIGHT_SYNC_DEADLINE_HOUR:-5}"
DEADLINE_MIN="${MIDNIGHT_SYNC_DEADLINE_MIN:-0}"
RETRY_SLEEP_SEC="${MIDNIGHT_SYNC_RETRY_SLEEP_SEC:-600}"
MAIL_EARLIEST_HOUR="${MIDNIGHT_MAIL_EARLIEST_HOUR:-3}"
VERIFY_PASSES="${MIDNIGHT_VERIFY_PASSES:-3}"

past_deadline() {
  local now_h now_m
  now_h="$(TZ=Asia/Kolkata date +%H)"
  now_m="$(TZ=Asia/Kolkata date +%M)"
  if [[ "$now_h" -gt "$DEADLINE_HOUR" ]]; then
    return 0
  fi
  if [[ "$now_h" -eq "$DEADLINE_HOUR" && "$now_m" -ge "$DEADLINE_MIN" ]]; then
    return 0
  fi
  return 1
}

wait_until_mail_time() {
  while true; do
    local now_h now_m
    now_h="$(TZ=Asia/Kolkata date +%H)"
    now_m="$(TZ=Asia/Kolkata date +%M)"
    if [[ "$now_h" -gt "$MAIL_EARLIEST_HOUR" ]]; then
      return 0
    fi
    if [[ "$now_h" -eq "$MAIL_EARLIEST_HOUR" && "$now_m" -ge 0 ]]; then
      return 0
    fi
    echo "=== waiting for mail window (${MAIL_EARLIEST_HOUR}:00 IST) — now ${now_h}:$(printf '%02d' "$now_m") ==="
    sleep 60
  done
}

midnight_repair() {
  echo "=== midnight repair — re-run catch-up + gaps after verify mismatch ==="
  if [[ -f "$STATE_FILE" ]]; then
    grep -v '^done:editedon-catchup$' "$STATE_FILE" | grep -v '^done:fill-hot-gaps$' >"${STATE_FILE}.tmp" || true
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
  bash "${SCRIPT_DIR}/midnight-calls-sync.sh" || true
}

run_verify() {
  MIDNIGHT_SYNC_AS_OF="${AS_OF}" npm run sync-worker:midnight-crm-verify -- --as-of "${AS_OF}"
}

attempt=1
while true; do
  echo "=== midnight calls sync attempt ${attempt} $(TZ=Asia/Kolkata date -Iseconds) deadline=${DEADLINE_HOUR}:$(printf '%02d' "$DEADLINE_MIN") IST ==="
  if bash "${SCRIPT_DIR}/midnight-calls-sync.sh"; then
    echo "=== midnight calls sync ok ==="
    break
  fi
  if past_deadline; then
    echo "FATAL: midnight calls sync failed — past deadline" >&2
    exit 1
  fi
  echo "=== midnight calls sync retry in ${RETRY_SLEEP_SEC}s ==="
  sleep "$RETRY_SLEEP_SEC"
  attempt=$((attempt + 1))
done

echo "=== CRM verify ${VERIFY_PASSES}× consecutive (hot must match CRM exactly) ==="
consecutive=0
while [[ "$consecutive" -lt "$VERIFY_PASSES" ]]; do
  if run_verify; then
    consecutive=$((consecutive + 1))
    echo "=== verify pass ${consecutive}/${VERIFY_PASSES} ==="
  else
    consecutive=0
    echo "=== verify FAIL — repair and retry (need ${VERIFY_PASSES} consecutive passes) ===" >&2
    if past_deadline; then
      echo "FATAL: verify failed past deadline — mail blocked" >&2
      exit 1
    fi
    midnight_repair
    sleep 120
  fi
done

VERIFY_MARKER="${INSTALL_ROOT}/shared/logs/midnight-crm-verify-ok-${AS_OF}"
touch "$VERIFY_MARKER"
echo "=== verify OK ${VERIFY_PASSES}/${VERIFY_PASSES} — marker ${VERIFY_MARKER} ==="

wait_until_mail_time

echo "=== midnight CRM delta mail (after sync + ${VERIFY_PASSES}× verify, ≥${MAIL_EARLIEST_HOUR}:00 IST) ==="
if bash "${SCRIPT_DIR}/midnight-crm-delta-mail.sh"; then
  echo "=== midnight-crm-delta complete ==="
else
  echo "FATAL: midnight CRM delta mail failed" >&2
  exit 1
fi
