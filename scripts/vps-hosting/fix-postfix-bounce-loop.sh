#!/usr/bin/env bash
# Fix Postfix "connect to wrl-fsm.cloud[…]:25: Connection refused" bounce loop.
#
# That error is NOT MIS delivery failing. Bounces to root@wrl-fsm.cloud were
# treated as remote mail → DNS pointed at the VPS public IP → nothing listens
# on public :25 (Postfix is loopback-only by design) → deferred forever.
#
# Fix: deliver our own domain locally, then drop the stuck junk queue.
#
#   bash scripts/vps-hosting/fix-postfix-bounce-loop.sh          # on VPS
#   bash scripts/vps-hosting/fix-postfix-bounce-loop-vps.sh      # from PC (SSH)
set -euo pipefail

MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"

if [[ "${1:-}" == "--remote" ]] || [[ "${0}" == *-vps.sh ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  # shellcheck disable=SC1090
  source "${ROOT}/.env.vps-setup"
  SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
  if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
    echo "ERROR: need interactive terminal for SSH passphrase." >&2
    exit 1
  fi
  if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    eval "$(ssh-agent -s)"
  fi
  echo "==> Enter SSH key passphrase for ${SSH_KEY}"
  ssh-add "$SSH_KEY"
  scp -q -i "$SSH_KEY" -o IdentitiesOnly=yes \
    "${ROOT}/scripts/vps-hosting/fix-postfix-bounce-loop.sh" \
    "${VPS_HOST}:/tmp/fix-postfix-bounce-loop.sh"
  ssh -i "$SSH_KEY" -o IdentitiesOnly=yes "$VPS_HOST" \
    "MAIL_DOMAIN='${MAIL_DOMAIN}' bash /tmp/fix-postfix-bounce-loop.sh"
  exit 0
fi

echo "==> Fixing local delivery for ${MAIL_DOMAIN} (stop bounce→public:25 loop)"
postconf -e "mydestination = \$myhostname, localhost.\$mydomain, localhost, ${MAIL_DOMAIN}, api.${MAIL_DOMAIN}"
# Keep outbound-only posture — do not open public :25 for this.
postconf -e "inet_interfaces = loopback-only" || true

systemctl reload postfix 2>/dev/null || systemctl restart postfix

echo "==> Clearing deferred junk queue (root@ / MAILER-DAEMON loops)"
before="$(mailq 2>/dev/null | tail -1 || true)"
postsuper -d ALL deferred 2>/dev/null || postsuper -d ALL || true
after="$(mailq 2>/dev/null | tail -1 || true)"

echo "    before: ${before}"
echo "    after:  ${after}"
echo "==> Done. MIS mail to Netcore/Gmail was never this path."
echo "    Recheck: mailq ; journalctl -u postfix -n 20 --no-pager"
