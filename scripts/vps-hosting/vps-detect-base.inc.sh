#!/usr/bin/env bash
# Shared remote one-liner: print install base (parent of current/releases).
# Prefer known paths; find under releases/ (find does not follow current →).
vps_ssh_detect_base_script() {
  local hint="${1:-/opt/fast-close-app}"
  cat <<EOF
hint='${hint}'
hint="\${hint%/current}"
for candidate in "\$hint" /opt/wrl/database/fast-close-app /opt/fast-close-app; do
  [[ -n "\$candidate" ]] || continue
  candidate="\${candidate%/current}"
  if [[ -e "\${candidate}/current/scripts/vps-hosting/mis-email-digest.sh" ]] \\
    || [[ -e "\${candidate}/current/scripts/vps-hosting/sync-worker-daemon.sh" ]]; then
    echo "\$candidate"
    exit 0
  fi
done
hit=\$(find /opt -path '*/releases/*/scripts/vps-hosting/mis-email-digest.sh' 2>/dev/null | head -n 1 || true)
if [[ -n "\$hit" ]]; then
  echo "\$hit" | sed -E 's|/releases/[^/]+/scripts/vps-hosting/mis-email-digest.sh||'
  exit 0
fi
hit=\$(find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null | grep -v '/releases/' | head -n 1 || true)
if [[ -n "\$hit" ]]; then
  echo "\$hit" | sed 's|/scripts/vps-hosting/mis-email-digest.sh||'
  exit 0
fi
echo "\$hint"
EOF
}
