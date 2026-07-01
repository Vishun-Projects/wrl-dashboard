#!/usr/bin/env bash
# Allow Docker containers (GoTrue) to relay through host Postfix — same path MIS uses.
set -euo pipefail

echo "==> Postfix: allow Docker bridge + localhost relay"
postconf -e 'inet_interfaces = all'
postconf -e 'mynetworks = 127.0.0.0/8, 172.16.0.0/12, 10.0.0.0/8, [::1]'
postconf -e 'smtpd_relay_restrictions = permit_mynetworks, reject'
postconf -e 'smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination'

systemctl restart postfix
sleep 2
systemctl is-active postfix

echo "==> Listening on port 25:"
ss -ltnp | grep ':25' || true
echo "==> Done — Docker can reach host Postfix at 172.17.0.1:25"
