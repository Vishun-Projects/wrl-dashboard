#!/usr/bin/env bash
# Deploy MIS email code to VPS so the */15 digest cron can find cli.ts.
# Syncs src/modules + src/lib + src/sql (CLI import graph). Asks for SSH passphrase.
# Does NOT touch .env.mis-email.
#
#   npm run mis-email:deploy:vps
#   # optional: also send today's digest now
#   RUN_DIGEST=1 npm run mis-email:deploy:vps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_ed25519}"
INSTALL_ROOT="${MIS_EMAIL_INSTALL_ROOT:-/opt/fast-close-app}"
RUN_DIGEST="${RUN_DIGEST:-0}"

SSH_OPTS=(
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -o IdentitiesOnly=yes
  -i "${SSH_KEY}"
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

if [[ -n "${VPS_SSH_PASSPHRASE:-}" ]]; then
  echo "==> Using SSH passphrase from environment..."
  ASKPASS_TMP=$(mktemp)
  echo "#!/usr/bin/env bash" > "$ASKPASS_TMP"
  echo "echo \"\$VPS_SSH_PASSPHRASE\"" >> "$ASKPASS_TMP"
  chmod +x "$ASKPASS_TMP"
  
  export DISPLAY="dummy:0"
  export SSH_ASKPASS="$ASKPASS_TMP"
  export SSH_ASKPASS_REQUIRE="force"
  
  if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    eval "$(ssh-agent -s)"
  fi
  ssh-add "$SSH_KEY" < /dev/null
  rm -f "$ASKPASS_TMP"
else
  if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
    echo "ERROR: need interactive terminal for SSH passphrase." >&2
    exit 1
  fi
  if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    eval "$(ssh-agent -s)"
  fi
  echo "==> Enter SSH key passphrase for ${SSH_KEY}"
  ssh-add "$SSH_KEY"
fi

echo "==> Detecting install root…"
detected_root=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  'find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | head -n 1 | sed "s|/scripts/vps-hosting/mis-email-digest.sh||"' || true)
if [[ -n "$detected_root" ]]; then
  INSTALL_ROOT="$detected_root"
fi
echo "    ${VPS_HOST}:${INSTALL_ROOT}"

echo "==> Syncing package.json + src/modules + src/lib + src/sql + digest scripts"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "mkdir -p '${INSTALL_ROOT}/src/modules' '${INSTALL_ROOT}/src/lib' '${INSTALL_ROOT}/src/sql' '${INSTALL_ROOT}/scripts/vps-hosting'"

if command -v rsync >/dev/null 2>&1; then
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/modules/" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/modules/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/lib/" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/lib/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/src/sql/" \
    "${VPS_HOST}:${INSTALL_ROOT}/src/sql/"
  rsync -az -e "$RSYNC_SSH" \
    "${ROOT}/scripts/vps-hosting/mis-email-digest.sh" \
    "${ROOT}/scripts/vps-hosting/mis-email-test-digest.sh" \
    "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
    "${ROOT}/scripts/vps-hosting/check-backfill-and-email-vps.sh" \
    "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
else
  scp "${SSH_OPTS[@]}" \
    "${ROOT}/package.json" "${ROOT}/package-lock.json" "${ROOT}/tsconfig.json" \
    "${VPS_HOST}:${INSTALL_ROOT}/"
  tar -C "${ROOT}" -czf - src/modules src/lib src/sql \
    | ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tar -xzf - -C '${INSTALL_ROOT}'"
  scp "${SSH_OPTS[@]}" \
    "${ROOT}/scripts/vps-hosting/mis-email-digest.sh" \
    "${ROOT}/scripts/vps-hosting/mis-email-test-digest.sh" \
    "${ROOT}/scripts/vps-hosting/vps-cron-gate.sh" \
    "${ROOT}/scripts/vps-hosting/check-backfill-and-email-vps.sh" \
    "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/"
fi

ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
  "chmod +x '${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh' '${INSTALL_ROOT}/scripts/vps-hosting/mis-email-test-digest.sh' '${INSTALL_ROOT}/scripts/vps-hosting/vps-cron-gate.sh'"

echo "==> Verifying cli path on VPS…"
ssh "${SSH_OPTS[@]}" "$VPS_HOST" bash -s <<REMOTE
set -euo pipefail
root='${INSTALL_ROOT}'
test -f "\$root/src/modules/mis-email/services/cli.ts"
grep -n 'mis-email:digest' "\$root/package.json" | head -3
# Register barrel must stay services-only (no UI re-exports) so cron does not need src/components.
! grep -q "export \* from './ui/" "\$root/src/modules/mis/register/index.ts"
! grep -q "export \* from './components/" "\$root/src/modules/mis/index.ts"
ls -la "\$root/.env.mis-email" >/dev/null
echo "OK: cli.ts + package.json + .env.mis-email + lib-only barrels"
REMOTE

if [[ "$RUN_DIGEST" == "1" ]]; then
  echo "==> Running today's digest now…"
  ssh "${SSH_OPTS[@]}" "$VPS_HOST" \
    "bash '${INSTALL_ROOT}/scripts/vps-hosting/mis-email-digest.sh'" \
    | tee /dev/stderr
fi

echo ""
echo "Deployed. Next */15 Mon–Sat IST cron tick should use this code."
echo "Send now: RUN_DIGEST=1 npm run mis-email:deploy:vps"
