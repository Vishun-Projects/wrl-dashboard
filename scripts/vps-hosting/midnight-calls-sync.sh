#!/usr/bin/env bash
# Thorough trhcalls → calls_latest_hot sync — once per day at midnight (before CRM delta mail).
# Daytime daemon skips calls incremental (SYNC_CALLS_DAEMON_ENABLED!=true).
#
# Hard rule: never ingest past previous IST calendar day (ceiling = AS_OF 23:59:59 IST).
# Default AS_OF = yesterday IST. Override with MIDNIGHT_SYNC_AS_OF=YYYY-MM-DD only when intentional.
set -euo pipefail

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

echo "=== midnight-calls-sync $(TZ=Asia/Kolkata date -Iseconds) ==="
echo "YTD status window ${YTD_START} .. ${AS_OF} (hard cap; calendar today=${IST_TODAY})"

# NEVER run watermark incremental here.
# Incremental queries editedon>=watermark through CRM "now". After any daytime mistake the
# watermark sits inside calendar today, so incremental would load today again — forbidden.
# Thorough repair through AS_OF is catch-up + reconciles + WCO only.
echo "→ skip incremental (forbidden on midnight path — would pull through CRM now / today)"

# Replay YTD rows where addedon <> editedon (late solves / cancels) through AS_OF only
echo "→ editedon catch-up ${YTD_START} .. ${AS_OF}"
MIDNIGHT_SYNC_AS_OF="${AS_OF}" npm run sync-worker:editedon-catchup -- --from "${YTD_START}" --to "${AS_OF}"

# 3) Open / assigned / tech_solved pipeline refresh
echo "→ pipeline reconcile"
npm run sync-worker:pipeline-reconcile

# 4) tech_solved → closed / cancelled
echo "→ reconcile tech_solved"
npm run sync-worker:reconcile-tech-solved -- --apply

# 5) Open/assigned orphans (transferred + cancelled)
echo "→ reconcile YTD open"
npm run sync-worker:reconcile-ytd-open -- --apply

# 6) Open→cancel drift vs live CRM
echo "→ reconcile open-cancel"
npm run sync-worker:reconcile-open-cancel || echo "WARN: open-cancel reconcile failed (non-fatal)"

# 7) Major / minor flags
echo "→ reconcile major"
npm run sync-worker:reconcile-major

# 8) WCO rolling window (late CRM edits)
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
echo "→ WCO backfill ${WCO_FROM} .. ${AS_OF}"
npm run sync-worker:backfill-wco -- --from "${WCO_FROM}" --to "${AS_OF}" || echo "WARN: WCO backfill failed (non-fatal)"

# 9) New logged TRNs never appear in editedon-only replay — upsert any CRM corpus TRNs still missing from hot
echo "→ fill missing corpus TRNs ${YTD_START} .. ${AS_OF}"
npm run sync-worker:fill-hot-gaps -- --from "${YTD_START}" --to "${AS_OF}" --skip-short-days || echo "WARN: fill-hot-gaps failed (non-fatal)"

echo "=== midnight-calls-sync done $(TZ=Asia/Kolkata date -Iseconds) AS_OF=${AS_OF} ==="
