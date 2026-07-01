#!/usr/bin/env bash
# Install Postfix + OpenDKIM on VPS for outbound mail (no personal Gmail needed).
# After setup, add the printed DNS records in Hostinger, then retry mis-email:test:vps.
#
# From Git Bash:
#   npm run mis-email:setup-postfix:vps
# On VPS directly:
#   bash scripts/vps-hosting/setup-vps-postfix.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"
MAIL_FROM_LOCAL="${MAIL_FROM_LOCAL:-reports}"
DKIM_SELECTOR="${DKIM_SELECTOR:-mis}"

run_postfix_setup() {
  echo "==> Installing Postfix + OpenDKIM (domain outbound mail)"
  export DEBIAN_FRONTEND=noninteractive
  debconf-set-selections <<< "postfix postfix/mailname string ${MAIL_DOMAIN}"
  debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"
  apt-get update -qq
  apt-get install -y -qq postfix mailutils opendkim opendkim-tools

  postconf -e "myhostname = api.${MAIL_DOMAIN}"
  postconf -e "myorigin = ${MAIL_DOMAIN}"
  postconf -e "mydestination = localhost"
  postconf -e "inet_interfaces = loopback-only"
  postconf -e "inet_protocols = ipv4"
  postconf -e "smtp_tls_security_level = may"

  setup_opendkim

  postconf -e "milter_protocol = 6"
  postconf -e "milter_default_action = accept"
  # Path is relative to Postfix chroot (/var/spool/postfix)
  postconf -e "smtpd_milters = local:opendkim/opendkim.sock"
  postconf -e "non_smtpd_milters = local:opendkim/opendkim.sock"

  systemctl enable postfix opendkim
  setup_opendkim_systemd_override
  systemctl restart opendkim
  systemctl restart postfix

  write_mis_email_env_snippet
  print_dns_records

  echo ""
  echo "==> Postfix ready on 127.0.0.1:25 (DKIM signing enabled)"
  echo "    Add the DNS records above in Hostinger, wait ~30–60 min, then:"
  echo "    npm run mis-email:test:vps"
}

setup_opendkim() {
  local key_dir="/etc/opendkim/keys/${MAIL_DOMAIN}"
  local signing_table="/etc/opendkim/SigningTable"
  local key_table="/etc/opendkim/KeyTable"
  local trusted_hosts="/etc/opendkim/TrustedHosts"
  local dkim_conf="/etc/opendkim.conf"

  mkdir -p "${key_dir}" /var/spool/postfix/opendkim
  chown opendkim:postfix /var/spool/postfix/opendkim
  chmod 750 /var/spool/postfix/opendkim

  if [[ ! -f "${key_dir}/${DKIM_SELECTOR}.private" ]]; then
    echo "==> Generating DKIM key (${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN})"
    opendkim-genkey -b 2048 -d "${MAIL_DOMAIN}" -D "${key_dir}" -s "${DKIM_SELECTOR}" -v
    chown -R opendkim:opendkim /etc/opendkim/keys
    chmod 600 "${key_dir}/${DKIM_SELECTOR}.private"
  else
    echo "==> DKIM key already exists (${key_dir}/${DKIM_SELECTOR}.private)"
  fi

  cat > "${signing_table}" <<EOF
*@${MAIL_DOMAIN} ${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}
EOF

  cat > "${key_table}" <<EOF
${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN} ${MAIL_DOMAIN}:${DKIM_SELECTOR}:${key_dir}/${DKIM_SELECTOR}.private
EOF

  cat > "${trusted_hosts}" <<EOF
127.0.0.1
localhost
${MAIL_DOMAIN}
api.${MAIL_DOMAIN}
EOF

  cat > "${dkim_conf}" <<EOF
Syslog                  yes
UMask                   002
Canonicalization        relaxed/simple
Mode                    sv
SubDomains              no
AutoRestart             yes
AutoRestartRate         10/1h
Socket                  local:/var/spool/postfix/opendkim/opendkim.sock
PidFile                 /var/run/opendkim/opendkim.pid
SigningTable            refile:${signing_table}
KeyTable                refile:${key_table}
ExternalIgnoreList      refile:${trusted_hosts}
InternalHosts           refile:${trusted_hosts}
EOF
}

setup_opendkim_systemd_override() {
  mkdir -p /etc/systemd/system/opendkim.service.d
  cat > /etc/systemd/system/opendkim.service.d/override.conf <<'EOF'
[Service]
User=opendkim
Group=postfix
EOF
  systemctl daemon-reload
}

print_dns_records() {
  local vps_ip dkim_value
  vps_ip="$(curl -s -4 --max-time 8 ifconfig.me 2>/dev/null || echo '187.127.145.253')"

  echo ""
  echo "========================================================================"
  echo "  ADD THESE DNS RECORDS IN HOSTINGER (wrl-fsm.cloud → DNS / DNS Zone)"
  echo "========================================================================"
  echo ""
  echo "1) SPF (TXT on root @)"
  echo "   Name:  @"
  echo "   Value: v=spf1 ip4:${vps_ip} ~all"
  echo ""
  echo "2) DKIM (TXT)"
  echo "   Name:  ${DKIM_SELECTOR}._domainkey"
  if [[ -f "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt" ]]; then
    dkim_value="$(awk -F'"' '{ for (i=2; i<NF; i++) printf "%s", $i }' "/etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt" | tr -d '\n\t ')"
    echo "   Value: v=DKIM1; h=sha256; k=rsa; ${dkim_value}"
  else
    echo "   Value: (run: cat /etc/opendkim/keys/${MAIL_DOMAIN}/${DKIM_SELECTOR}.txt)"
  fi
  echo ""
  echo "3) DMARC (TXT, optional but helps Gmail)"
  echo "   Name:  _dmarc"
  echo "   Value: v=DMARC1; p=none; rua=mailto:${MAIL_FROM_LOCAL}@${MAIL_DOMAIN}"
  echo ""
  echo "   VPS IP used in SPF: ${vps_ip}"
  echo "========================================================================"
}

write_mis_email_env_snippet() {
  local root="${INSTALL_ROOT:-/opt/fast-close-app}"
  mkdir -p "${root}/scripts/vps-hosting" "${root}/logs" 2>/dev/null || true
  if [[ ! -d "${root}" ]]; then
    return 0
  fi
  cat > "${root}/.env.mis-email" <<EOF
SMTP_HOST=127.0.0.1
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM="WRL MIS Reports <${MAIL_FROM_LOCAL}@${MAIL_DOMAIN}>"

MIS_EMAIL_TEST_TO=vishnu.vishwakarma@westernequipments.com
MIS_EMAIL_PORTAL_URL=https://wrl-dashboard.vercel.app

READ_SUMMARY_FROM=postgres
READ_CALLS_FROM=postgres
USE_DIRECT_DATABASE=false
PG_SSL=false
DATABASE_URL=postgresql://postgres.ddmapuyghfeoyajxbcjh:CHANGE_ME@127.0.0.1:6543/postgres?pgbouncer=true
EOF
  echo "    Created ${root}/.env.mis-email — DATABASE_URL is set by mis-email:test:vps"
}

if [[ "${1:-}" == "--remote" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing ${ENV_FILE}" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  VPS_HOST="${VPS_HOST:?Set VPS_HOST}"
  scp "${ROOT}/scripts/vps-hosting/setup-vps-postfix.sh" "${VPS_HOST}:/root/setup-vps-postfix.sh"
  ssh -t "$VPS_HOST" \
    "MAIL_DOMAIN='${MAIL_DOMAIN}' DKIM_SELECTOR='${DKIM_SELECTOR}' INSTALL_ROOT='${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}' bash /root/setup-vps-postfix.sh"
  exit 0
fi

if [[ "${1:-}" == "--dns-only" ]]; then
  print_dns_records
  exit 0
fi

run_postfix_setup
