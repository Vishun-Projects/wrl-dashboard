#!/usr/bin/env bash
# Thorough trhcalls → calls_latest_hot sync — overnight window (00:00+ IST).
# Daytime daemon skips calls incremental (SYNC_CALLS_DAEMON_ENABLED!=true).
#
# Hard rule: never ingest past previous IST calendar day (ceiling = AS_OF 23:59:59 IST).
# Default AS_OF = yesterday IST. Override with MIDNIGHT_SYNC_AS_OF=YYYY-MM-DD only when intentional.
#
# Resilient: per-step retries + checkpoint file so retries/deadline loops skip finished work.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALL_ROOT="${SYNC_WORKER_INSTALL_ROOT:-${MIS_EMAIL_INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}}"
INSTALL_ROOT="${INSTALL_ROOT%/current}"
# Prefer release current/ when present
if [[ -e "${INSTALL_ROOT}/current/package.json" ]]; then
  cd "${INSTALL_ROOT}/current"
else
  cd "$INSTALL_ROOT"
fi

if [[ -f "${INSTALL_ROOT}/shared/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/shared/.env.sync-worker")
  set +a
elif [[ -f "${INSTALL_ROOT}/.env.sync-worker" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' "${INSTALL_ROOT}/.env.sync-worker")
  set +a
elif [[ -f .env.sync-worker ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed 's/\r$//' .env.sync-worker)
  set +a
fi

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export TZ="${TZ:-Asia/Kolkata}"

SYNC_WORKER_ENABLED="$(echo -n "${SYNC_WORKER_ENABLED:-}" | tr -d '\r' | xargs || true)"
if [[ "${SYNC_WORKER_ENABLED}" != "true" ]]; then
  echo "FATAL: SYNC_WORKER_ENABLED is not true — cannot run midnight calls sync" >&2
  exit 1
fi

YTD_START="${SYNC_EDITEDON_CATCHUP_FROM:-$(TZ=Asia/Kolkata date +%Y)-01-01}"
IST_TODAY="$(TZ=Asia/Kolkata date +%Y-%m-%d)"

# Default = yesterday IST — never a second into calendar "today".
if [[ -z "${MIDNIGHT_SYNC_AS_OF:-}" ]]; then
  if TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d >/dev/null 2>&1; then
    MIDNIGHT_SYNC_AS_OF="$(TZ=Asia/Kolkata date -d yesterday +%Y-%m-%d)"
  else
    MIDNIGHT_SYNC_AS_OF="$(TZ=Asia/Kolkata date -v-1d +%Y-%m-%d)"
  fi
fi
export MIDNIGHT_SYNC_AS_OF
AS_OF="$MIDNIGHT_SYNC_AS_OF"

if [[ "$AS_OF" > "$IST_TODAY" ]]; then
  echo "FATAL: MIDNIGHT_SYNC_AS_OF=${AS_OF} is in the future (today=${IST_TODAY})" >&2
  exit 1
fi
if [[ "$AS_OF" == "$IST_TODAY" ]]; then
  echo "FATAL: MIDNIGHT_SYNC_AS_OF cannot be today (${IST_TODAY}) — use yesterday or earlier" >&2
  exit 1
fi

STATE_DIR="${INSTALL_ROOT}/shared/logs/midnight-sync"
mkdir -p "$STATE_DIR"
STATE_FILE="${STATE_DIR}/state-${AS_OF}.env"
STEP_RETRIES="${MIDNIGHT_STEP_RETRIES:-3}"

step_done() {
  [[ -f "$STATE_FILE" ]] && grep -qx "done:$1" "$STATE_FILE"
}

mark_done() {
  echo "done:$1" >>"$STATE_FILE"
}

run_step() {
  local name=$1
  shift
  if step_done "$name"; then
    echo "→ skip $name (checkpoint ok)"
    return 0
  fi
  local attempt=1
  while [[ "$attempt" -le "$STEP_RETRIES" ]]; do
    echo "→ $name (attempt ${attempt}/${STEP_RETRIES})"
    if "$@"; then
      mark_done "$name"
      return 0
    fi
    echo "WARN: $name failed attempt ${attempt}/${STEP_RETRIES}" >&2
    attempt=$((attempt + 1))
    if [[ "$attempt" -le "$STEP_RETRIES" ]]; then
      sleep $((attempt * 90))
    fi
  done
  echo "FATAL: $name failed after ${STEP_RETRIES} attempt(s)" >&2
  return 1
}

fatal=0

echo "=== midnight-calls-sync $(TZ=Asia/Kolkata date -Iseconds) ==="
echo "YTD status window ${YTD_START} .. ${AS_OF} (hard cap; calendar today=${IST_TODAY})"
echo "checkpoint=${STATE_FILE} step_retries=${STEP_RETRIES}"

# NEVER run watermark incremental here — would pull through CRM now / today.
echo "→ skip incremental (forbidden on midnight path — would pull through CRM now / today)"

run_editedon_catchup() {
  # Full YTD replay Jan 1 → AS_OF every midnight (not cursor-shortcut).
  MIDNIGHT_SYNC_AS_OF="${AS_OF}" npm run sync-worker:editedon-catchup -- --from "${YTD_START}" --to "${AS_OF}" --no-resume
}

if ! run_step editedon-catchup run_editedon_catchup; then
  fatal=1
fi

if ! run_step pipeline-reconcile npm run sync-worker:pipeline-reconcile; then
  fatal=1
fi

if ! run_step reconcile-tech-solved npm run sync-worker:reconcile-tech-solved -- --apply; then
  fatal=1
fi

if ! run_step reconcile-ytd-open npm run sync-worker:reconcile-ytd-open -- --apply; then
  fatal=1
fi

run_step reconcile-open-cancel npm run sync-worker:reconcile-open-cancel \
  || echo "WARN: open-cancel reconcile failed (non-fatal)"

if ! run_step reconcile-major npm run sync-worker:reconcile-major; then
  fatal=1
fi

WCO_FROM="${WCO_BACKFILL_FROM:-}"
if [[ -z "$WCO_FROM" ]]; then
  if date -d "${AS_OF} -2 days" +%Y-%m-%d >/dev/null 2>&1; then
    WCO_FROM="$(date -d "${AS_OF} -2 days" +%Y-%m-%d)"
  elif date -v-2d -j -f "%Y-%m-%d" "${AS_OF}" +%Y-%m-%d >/dev/null 2>&1; then
    WCO_FROM="$(date -v-2d -j -f "%Y-%m-%d" "${AS_OF}" +%Y-%m-%d)"
  else
    WCO_FROM="$AS_OF"
  fi
fi

run_step backfill-wco npm run sync-worker:backfill-wco -- --from "${WCO_FROM}" --to "${AS_OF}" \
  || echo "WARN: WCO backfill failed (non-fatal)"

run_step fill-hot-gaps npm run sync-worker:fill-hot-gaps -- --from "${YTD_START}" --to "${AS_OF}" \
  || echo "WARN: fill-hot-gaps failed (non-fatal)"

if [[ "$fatal" -ne 0 ]]; then
  echo "=== midnight-calls-sync INCOMPLETE $(TZ=Asia/Kolkata date -Iseconds) AS_OF=${AS_OF} ===" >&2
  exit 1
fi

mark_done all
echo "=== midnight-calls-sync done $(TZ=Asia/Kolkata date -Iseconds) AS_OF=${AS_OF} ==="
