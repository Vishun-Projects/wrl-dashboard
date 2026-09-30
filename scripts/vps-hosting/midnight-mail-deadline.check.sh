#!/usr/bin/env bash
# Assert 07:30 defaults + fallback never-skips-on-lock behavior is wired.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
main="${ROOT}/scripts/vps-hosting/nightly-ytd-calls-export.sh"
fb="${ROOT}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh"
install="${ROOT}/scripts/vps-hosting/install-nightly-ytd-export-cron-vps.sh"

grep -q 'MIDNIGHT_SYNC_DEADLINE_MIN:-30' "$main"
grep -q 'MIDNIGHT_MAIL_EARLIEST_MIN:-30' "$main"
grep -q 'run_sync_with_deadline' "$main"
grep -q 'kill_tree' "$main"
grep -q '07:30 hard deadline' "$fb"
grep -q 'mailing anyway' "$fb"
grep -q '30 7 \* \* \*' "$install"
grep -qv 'SKIP fallback — 07:00 job still running' "$fb"

echo 'midnight-mail-deadline.check.sh ok'
