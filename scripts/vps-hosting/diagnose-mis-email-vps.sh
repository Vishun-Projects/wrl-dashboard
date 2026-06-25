#!/usr/bin/env bash
# Postfix delivery diagnostics on VPS — run from Git Bash:
#   npm run mis-email:diagnose:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mis}"
TEST_TO="${MIS_EMAIL_TEST_TO:-vishunvishwakarma90211@gmail.com}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST}"

ssh -t "$VPS_HOST" \
  "MAIL_DOMAIN='${MAIL_DOMAIN}' DKIM_SELECTOR='${DKIM_SELECTOR}' TEST_TO='${TEST_TO}' bash -s" <<'REMOTE'
set -euo pipefail

echo "==> Postfix / OpenDKIM"
systemctl is-active postfix 2>/dev/null && echo "    postfix: active" || echo "    postfix: NOT running"
systemctl is-active opendkim 2>/dev/null && echo "    opendkim: active" || echo "    opendkim: NOT installed — run: npm run mis-email:setup-postfix:vps"

echo ""
echo "==> Postfix queue"
postqueue -p 2>/dev/null | head -25 || echo "(postqueue unavailable)"

echo ""
echo "==> Recent mail.log lines for ${TEST_TO}"
if [[ -f /var/log/mail.log ]]; then
  grep -F "${TEST_TO}" /var/log/mail.log 2>/dev/null | tail -15 || echo "(no lines for recipient)"
else
  journalctl -u postfix --no-pager -n 40 2>/dev/null | tail -20 || true
fi

echo ""
echo "==> Recent delivery status (sent/bounced/deferred/reject)"
if [[ -f /var/log/mail.log ]]; then
  grep -E 'status=(sent|bounced|deferred|reject)' /var/log/mail.log 2>/dev/null | tail -10 || true
fi

VPS_IP="$(curl -s -4 --max-time 5 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "==> DNS (required for Gmail — no personal SMTP needed)"
echo "    VPS public IP: ${VPS_IP:-unknown}"
echo ""
echo "    SPF on ${MAIL_DOMAIN}:"
if dig +short TXT "${MAIL_DOMAIN}" 2>/dev/null | grep -qi spf; then
  dig +short TXT "${MAIL_DOMAIN}" 2>/dev/null | grep -i spf
else
  echo "    MISSING — add TXT @ : v=spf1 ip4:${VPS_IP} ~all"
fi
echo ""
echo "    DKIM (${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}):"
if dig +short TXT "${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}" 2>/dev/null | grep -qi DKIM; then
  dig +short TXT "${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}" 2>/dev/null | head -1
else
  echo "    MISSING — run: npm run mis-email:dns:vps  (copy record to Hostinger)"
fi
echo ""
echo "    PTR for ${VPS_IP}:"
dig +short -x "${VPS_IP}" 2>/dev/null || echo "    (optional — set reverse DNS in Hostinger VPS panel if available)"

echo ""
echo "==> Next steps (domain mail only, no personal Gmail)"
echo "  1. npm run mis-email:setup-postfix:vps   # if opendkim not active"
echo "  2. npm run mis-email:dns:vps             # copy SPF + DKIM to Hostinger DNS"
echo "  3. Wait ~30–60 min, then: npm run mis-email:test:vps"
REMOTE
