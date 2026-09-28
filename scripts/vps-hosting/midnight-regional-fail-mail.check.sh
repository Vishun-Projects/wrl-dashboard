#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash -n "${dir}/midnight-regional-fail-mail.inc.sh"
bash -n "${dir}/nightly-ytd-calls-export.sh"
bash -n "${dir}/midnight-crm-delta-mail-fallback.sh"
grep -q 'FAILED: WRL Midnight MIS Regional' "${dir}/midnight-regional-fail-mail.inc.sh"
grep -q 'send_midnight_regional_fail_mail' "${dir}/nightly-ytd-calls-export.sh"
grep -q 'send_midnight_regional_fail_mail' "${dir}/midnight-crm-delta-mail-fallback.sh"
echo 'midnight-regional-fail-mail ok'
