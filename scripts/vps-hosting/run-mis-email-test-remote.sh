#!/usr/bin/env bash
# Runs ON the VPS — invoked by run-mis-email-test-vps.sh after tar sync.
set -euo pipefail

root="${INSTALL_ROOT:-/opt/fast-close-app}"
MAIL_DOMAIN="${MAIL_DOMAIN:-wrl-fsm.cloud}"
TEST_TO="${MIS_EMAIL_TEST_TO:-vishunvishwakarma90211@gmail.com}"

cd "${root}"

# Stale dev env files must not poison DATABASE_URL on VPS
rm -f "${root}/.env" "${root}/.env.local" "${root}/.env.mis-email"

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    echo "==> Node $(node -v)"
    return 0
  fi
  echo "==> Installing Node.js 20"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo "    Node $(node -v) installed"
}

resolve_database_url() {
  local db_url="" f line pass
  local tenant="${POOLER_TENANT_ID:-ddmapuyghfeoyajxbcjh}"

  pass=""
  if [[ -f /opt/supabase/docker/.env ]]; then
    # shellcheck disable=SC1091
    set -a
    source /opt/supabase/docker/.env
    set +a
    pass="${POSTGRES_PASSWORD:-}"
    tenant="${POOLER_TENANT_ID:-${tenant}}"
  fi
  if [[ -z "$pass" && -n "${LOCAL_PG_PASS:-}" ]]; then
    pass="${LOCAL_PG_PASS}"
  fi
  if [[ -n "$pass" ]]; then
    echo "postgresql://postgres.${tenant}:${pass}@127.0.0.1:6543/postgres?pgbouncer=true"
    return 0
  fi

  for f in "${root}/.env.mis-email" "${root}/.env" "${root}/.env.local"; do
    if [[ -f "$f" ]]; then
      line=$(grep -E '^DATABASE_URL=' "$f" 2>/dev/null | head -1 || true)
      if [[ -n "$line" && "$line" != *CHANGE_ME* && "$line" != *prisma+postgres* ]]; then
        db_url="${line#DATABASE_URL=}"
        db_url="${db_url%\"}"
        db_url="${db_url#\"}"
        db_url="${db_url#\'}"
        db_url="${db_url%\'}"
        echo "$db_url"
        return 0
      fi
    fi
  done

  return 1
}

write_smtp_block() {
  if [[ -n "${MIS_SMTP_GMAIL_USER:-}" && -n "${MIS_SMTP_GMAIL_APP_PASSWORD:-}" ]]; then
    echo "==> SMTP: Gmail relay (${MIS_SMTP_GMAIL_USER})" >&2
    cat <<EOF
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=${MIS_SMTP_GMAIL_USER}
SMTP_PASS="${MIS_SMTP_GMAIL_APP_PASSWORD}"
SMTP_FROM="WRL MIS Reports <${MIS_SMTP_GMAIL_USER}>"
EOF
    return 0
  fi
  echo "==> SMTP: local Postfix (127.0.0.1:25) — Gmail may block without SPF/DKIM" >&2
  cat <<EOF
SMTP_HOST=127.0.0.1
SMTP_PORT=25
SMTP_SECURE=false
SMTP_FROM="WRL MIS Reports <reports@${MAIL_DOMAIN}>"
EOF
}

check_postfix_delivery() {
  [[ -n "${MIS_SMTP_GMAIL_USER:-}" ]] && return 0
  sleep 4
  echo ""
  echo "==> Postfix delivery log (last lines for ${TEST_TO})"
  if [[ -f /var/log/mail.log ]]; then
    grep -F "${TEST_TO}" /var/log/mail.log 2>/dev/null | tail -6 || echo "    (no log lines — check: bash scripts/vps-hosting/diagnose-mis-email-vps.sh)"
  fi
  if command -v postqueue >/dev/null 2>&1; then
    local q
    q="$(postqueue -p 2>/dev/null | head -5 || true)"
    if [[ -n "$q" && "$q" != *"Mail queue is empty"* ]]; then
      echo "==> Postfix queue (stuck mail):"
      echo "$q"
    fi
  fi
  local ip
  ip="$(curl -s -4 --max-time 5 ifconfig.me 2>/dev/null || echo '187.127.145.253')"
  if ! dig +short TXT "${MAIL_DOMAIN}" 2>/dev/null | grep -qi spf; then
    echo ""
    echo "!! No SPF on ${MAIL_DOMAIN} — Gmail often drops VPS mail silently."
    echo "   Run: npm run mis-email:dns:vps"
    echo "   Add the SPF + DKIM TXT records in Hostinger, wait ~1h, retry."
  fi
}

mkdir -p "${root}/logs"
ensure_node

db_url=""
if ! db_url="$(resolve_database_url)"; then
  echo "FATAL: Could not resolve DATABASE_URL." >&2
  echo "  Set POSTGRES_PASSWORD in .env.vps-setup on your PC." >&2
  exit 1
fi
echo "==> DATABASE_URL resolved (pooler @ 127.0.0.1:6543)"

cat > "${root}/.env.mis-email" <<EOF
$(write_smtp_block)

MIS_EMAIL_TEST_TO=${TEST_TO}
MIS_EMAIL_PORTAL_URL=https://${MAIL_DOMAIN}

READ_SUMMARY_FROM=postgres
READ_CALLS_FROM=postgres
USE_DIRECT_DATABASE=false
PG_SSL=false
DATABASE_URL=${db_url}
EOF

echo "==> npm install"
npm install --omit=dev 2>&1 | tail -8

echo "==> mis-email:test"
# dotenv in cli loads .env.mis-email only; export as backup for npm child
set -a
# shellcheck disable=SC1091
source "${root}/.env.mis-email"
set +a
npm run mis-email:test
check_postfix_delivery
