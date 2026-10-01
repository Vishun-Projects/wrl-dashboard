#!/usr/bin/env bash
# Assert midnight catch-up defaults to last 7 days through AS_OF (not Jan 1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
script="${ROOT}/scripts/vps-hosting/midnight-calls-sync.sh"
grep -q 'MIDNIGHT_CATCHUP_DAYS:-7' "$script"
grep -q 'CATCHUP_FROM' "$script"
! grep -q 'YTD_START=.*-01-01' "$script"
echo "midnight-calls-catchup-window ok"
