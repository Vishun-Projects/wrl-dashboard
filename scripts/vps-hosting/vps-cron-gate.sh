#!/usr/bin/env bash
# Soft-skip if Super Admin paused this job in the portal.
# Exit 0 always from this helper's perspective for the caller:
#   vps_cron_gate_allow <jobId> || exit 0
# (gate exit 2 = paused → allow returns 1; other failures also skip to avoid mail spam)
vps_cron_gate_allow() {
  local job_id="${1:?job id required}"
  local root="${INSTALL_ROOT:-${MIS_EMAIL_INSTALL_ROOT:-}}"
  if [[ -z "$root" ]]; then
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fi
  if [[ ! -f "${root}/src/lib/vps-cron/cli-gate.ts" ]]; then
    echo "vps-cron-gate: missing cli-gate.ts — allowing run (deploy may be incomplete)"
    return 0
  fi
  set +e
  (
    cd "$root"
    npx tsx src/lib/vps-cron/cli-gate.ts "$job_id"
  )
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi
  if [[ "$rc" -eq 2 ]]; then
    echo "=== ${job_id} skipped — paused in portal (Super Admin → VPS Cron) ==="
    return 1
  fi
  echo "=== ${job_id} skipped — cron gate failed (rc=${rc}); fix DB/env then re-run ===" >&2
  return 1
}
