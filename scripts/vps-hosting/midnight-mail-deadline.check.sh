#!/usr/bin/env bash
# Assert 07:30 defaults + fallback does not double-mail when primary holds lock post-verify.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
main="${ROOT}/scripts/vps-hosting/nightly-ytd-calls-export.sh"
fb="${ROOT}/scripts/vps-hosting/midnight-crm-delta-mail-fallback.sh"
mail="${ROOT}/scripts/vps-hosting/midnight-crm-delta-mail.sh"
install="${ROOT}/scripts/vps-hosting/install-nightly-ytd-export-cron-vps.sh"

grep -q 'MIDNIGHT_SYNC_DEADLINE_MIN:-30' "$main"
grep -q 'MIDNIGHT_MAIL_EARLIEST_MIN:-30' "$main"
grep -q 'run_sync_with_deadline' "$main"
grep -q 'kill_tree' "$main"
grep -q '07:30 hard deadline' "$fb"
grep -q 'primary will send SUCCESS' "$fb"
grep -q 'flock -n 9' "$mail"
grep -q '30 7 \* \* \*' "$install"
grep -qv 'mailing anyway' "$fb"

echo 'midnight-mail-deadline.check.sh ok'
