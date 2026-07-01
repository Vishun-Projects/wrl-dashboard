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

echo "==> UFW: allow Docker subnets to reach host port 25"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow from 172.16.0.0/12 to any port 25 proto tcp comment 'Docker to Postfix' >/dev/null 2>&1 || true
  ufw reload >/dev/null 2>&1 || true
fi

echo "==> iptables: allow Docker → host SMTP"
if iptables -L INPUT -n >/dev/null 2>&1; then
  iptables -C INPUT -p tcp -s 172.16.0.0/12 --dport 25 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 1 -p tcp -s 172.16.0.0/12 --dport 25 -j ACCEPT
fi

echo "==> Listening on port 25:"
ss -ltnp | grep ':25' || true
echo "==> Done — host Postfix accepts relay from Docker networks"
