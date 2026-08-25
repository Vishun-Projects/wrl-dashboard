#!/usr/bin/env bash
# Remote-side helpers for git-SHA releases under /opt/fast-close-app.
# Sourced on the VPS by sync-worker-deploy-vps.sh / sync-worker-rollback-vps.sh.
#
# Layout:
#   BASE/current  -> releases/<sha>
#   BASE/previous -> releases/<old-sha>
#   BASE/releases/<sha>/
#   BASE/shared/{.env.sync-worker,.env.mis-email,logs,node_modules}
#   BASE/release-history   (newest SHA first, keep 5; not "RELEASES" — collides with releases/ on case-insensitive FS)
set -euo pipefail

vps_release_keep="${VPS_RELEASE_KEEP:-5}"

# Prefer .../current over nested releases/* or flat trees.
# Note: plain `find` does NOT follow the `current` symlink — check candidates + releases/ first.
vps_detect_base() {
  local hint="${1:-/opt/fast-close-app}"
  hint="${hint%/current}"
  local candidate
  for candidate in \
    "$hint" \
    /opt/wrl/database/fast-close-app \
    /opt/fast-close-app; do
    [[ -n "$candidate" ]] || continue
    candidate="${candidate%/current}"
    if [[ -e "${candidate}/current/scripts/vps-hosting/mis-email-digest.sh" ]] \
      || [[ -e "${candidate}/current/scripts/vps-hosting/sync-worker-daemon.sh" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  local hit
  hit=$(find /opt -path '*/releases/*/scripts/vps-hosting/mis-email-digest.sh' 2>/dev/null | head -n 1 || true)
  if [[ -n "$hit" ]]; then
    echo "$hit" | sed -E 's|/releases/[^/]+/scripts/vps-hosting/mis-email-digest.sh||'
    return 0
  fi
  hit=$(find /opt -name "mis-email-digest.sh" -path "*/scripts/vps-hosting/mis-email-digest.sh" 2>/dev/null \
    | grep -v '/releases/' | head -n 1 || true)
  if [[ -n "$hit" ]]; then
    echo "$hit" | sed 's|/scripts/vps-hosting/mis-email-digest.sh||'
    return 0
  fi
  echo "$hint"
}

vps_code_root() {
  local base="${1:?}"
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    echo "${base}/current"
  else
    echo "$base"
  fi
}

vps_link_shared_into_release() {
  local base="${1:?}"
  local rel="${2:?}"
  mkdir -p "${base}/shared/logs"
  ln -sfn "${base}/shared/logs" "${rel}/logs"
  if [[ -d "${base}/shared/node_modules" ]]; then
    ln -sfn "${base}/shared/node_modules" "${rel}/node_modules"
  fi
  for f in .env.sync-worker .env.mis-email; do
    if [[ -f "${base}/shared/${f}" ]]; then
      ln -sfn "${base}/shared/${f}" "${rel}/${f}"
    fi
  done
}

vps_rewrite_systemd_to_current() {
  local base="${1:?}"
  local code="${base}/current"
  local shared_env="${base}/shared/.env.sync-worker"
  local unit="/etc/systemd/system/fast-close-sync-worker.service"
  local nightly="/etc/systemd/system/fast-close-sync-worker-nightly.service"

  if [[ ! -d "$code" && ! -L "$code" ]]; then
    echo "WARN: ${code} missing — skip systemd rewrite" >&2
    return 0
  fi

  if [[ ! -w /etc/systemd/system ]] 2>/dev/null; then
    echo "WARN: cannot write systemd units — skip rewrite (ok for local check)" >&2
    return 0
  fi

  cat >"$unit" <<EOF
[Unit]
Description=Fast Close CRM read-model sync worker (incremental + pipeline reconcile + editedon catch-up every 3 min)
Documentation=file://${code}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${code}
Environment=HOME=/root
Environment=SYNC_WORKER_INSTALL_ROOT=${code}
EnvironmentFile=-${shared_env}
EnvironmentFile=-${code}/.env.sync-worker
ExecStart=${code}/scripts/vps-hosting/sync-worker-daemon.sh
Restart=always
RestartSec=30
StandardOutput=append:${base}/shared/logs/sync-worker.log
StandardError=append:${base}/shared/logs/sync-worker.log

[Install]
WantedBy=multi-user.target
EOF

  if [[ -f "$nightly" ]] || systemctl list-unit-files fast-close-sync-worker-nightly.service 2>/dev/null | grep -q fast-close; then
    cat >"$nightly" <<EOF
[Unit]
Description=Fast Close CRM read-model nightly reconcile (editedon catch-up + YTD open scan)
Documentation=file://${code}/docs/sync.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${code}
Environment=SYNC_WORKER_INSTALL_ROOT=${code}
EnvironmentFile=-${shared_env}
EnvironmentFile=-${code}/.env.sync-worker
ExecStart=${code}/scripts/vps-hosting/sync-worker-nightly.sh
StandardOutput=append:${base}/shared/logs/sync-worker-nightly.log
StandardError=append:${base}/shared/logs/sync-worker-nightly.log
EOF
  fi

  systemctl daemon-reload 2>/dev/null || true
}

# One-time: flat BASE → releases/ + shared/ + current
vps_migrate_flat_to_releases() {
  local base="${1:?}"
  if [[ -L "${base}/current" || -d "${base}/current" ]]; then
    echo "==> Release layout already present at ${base}"
    return 0
  fi
  if [[ ! -d "$base" ]]; then
    mkdir -p "${base}/releases" "${base}/shared/logs"
    echo "==> Created empty release base ${base}"
    return 0
  fi

  echo "==> Migrating flat install at ${base} → releases/ + shared/"
  systemctl stop fast-close-sync-worker 2>/dev/null || true

  mkdir -p "${base}/releases" "${base}/shared"
  local sha="bootstrap-$(TZ=Asia/Kolkata date +%Y%m%d%H%M%S)"
  local rel="${base}/releases/${sha}"
  mkdir -p "$rel"

  # Shared state first
  for f in .env.sync-worker .env.mis-email; do
    if [[ -e "${base}/${f}" && ! -e "${base}/shared/${f}" ]]; then
      mv "${base}/${f}" "${base}/shared/${f}"
    fi
  done
  if [[ -d "${base}/logs" && ! -d "${base}/shared/logs" ]]; then
    mv "${base}/logs" "${base}/shared/logs"
  else
    mkdir -p "${base}/shared/logs"
  fi
  if [[ -d "${base}/node_modules" && ! -d "${base}/shared/node_modules" ]]; then
    mv "${base}/node_modules" "${base}/shared/node_modules"
  fi

  # Move remaining code into bootstrap release (skip layout dirs)
  local item
  for item in "${base}"/* "${base}"/.[!.]*; do
    [[ -e "$item" ]] || continue
    local name
    name="$(basename "$item")"
    case "$name" in
      releases|shared|current|previous|release-history) continue ;;
      .|..) continue ;;
    esac
    mv "$item" "${rel}/"
  done

  vps_link_shared_into_release "$base" "$rel"
  ln -sfn "releases/${sha}" "${base}/current"
  ln -sfn "releases/${sha}" "${base}/previous"
  printf '%s\n' "$sha" >"${base}/release-history"

  chmod +x "${rel}/scripts/vps-hosting/"*.sh 2>/dev/null || true
  vps_rewrite_systemd_to_current "$base"
  echo "    Migrated → current=${sha}"
}

vps_activate_release() {
  local base="${1:?}"
  local sha="${2:?}"
  local rel="${base}/releases/${sha}"
  if [[ ! -d "$rel" ]]; then
    echo "ERROR: release dir missing: ${rel}" >&2
    return 1
  fi
  vps_link_shared_into_release "$base" "$rel"
  chmod +x "${rel}/scripts/vps-hosting/"*.sh 2>/dev/null || true

  local old=""
  if [[ -L "${base}/current" ]]; then
    old="$(readlink "${base}/current" | sed 's|^releases/||')"
  elif [[ -d "${base}/current" ]]; then
    old="$(basename "$(readlink -f "${base}/current")")"
  fi

  if [[ -n "$old" && "$old" != "$sha" ]]; then
    ln -sfn "releases/${old}" "${base}/previous"
  elif [[ ! -e "${base}/previous" ]]; then
    ln -sfn "releases/${sha}" "${base}/previous"
  fi
  ln -sfn "releases/${sha}" "${base}/current"

  # Prepend SHA to release-history (unique)
  local tmp
  tmp="$(mktemp)"
  {
    echo "$sha"
    if [[ -f "${base}/release-history" ]]; then
      grep -vx "$sha" "${base}/release-history" || true
    fi
  } >"$tmp"
  mv "$tmp" "${base}/release-history"

  vps_rewrite_systemd_to_current "$base"
  echo "activated=${sha} previous=$(readlink "${base}/previous" 2>/dev/null || echo '?')"
}

vps_prune_releases() {
  local base="${1:?}"
  local keep="${2:-$vps_release_keep}"
  local protect_current protect_previous
  protect_current="$(readlink "${base}/current" 2>/dev/null | sed 's|^releases/||' || true)"
  protect_previous="$(readlink "${base}/previous" 2>/dev/null | sed 's|^releases/||' || true)"

  if [[ ! -f "${base}/release-history" ]]; then
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  head -n "$keep" "${base}/release-history" >"$tmp"
  mv "$tmp" "${base}/release-history"

  local dir sha
  for dir in "${base}/releases"/*; do
    [[ -d "$dir" ]] || continue
    sha="$(basename "$dir")"
    if grep -qx "$sha" "${base}/release-history"; then
      continue
    fi
    if [[ "$sha" == "$protect_current" || "$sha" == "$protect_previous" ]]; then
      continue
    fi
    echo "==> Pruning old release ${sha}"
    rm -rf "$dir"
  done
}

vps_rollback_to() {
  local base="${1:?}"
  local target="${2:-}"
  if [[ -z "$target" ]]; then
    if [[ ! -L "${base}/previous" && ! -d "${base}/previous" ]]; then
      echo "ERROR: no previous symlink at ${base}/previous" >&2
      return 1
    fi
    target="$(readlink "${base}/previous" | sed 's|^releases/||')"
  fi
  # Allow short prefix match
  if [[ ! -d "${base}/releases/${target}" ]]; then
    local match
    match="$(find "${base}/releases" -maxdepth 1 -type d -name "${target}*" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$match" ]]; then
      target="$(basename "$match")"
    fi
  fi
  if [[ ! -d "${base}/releases/${target}" ]]; then
    echo "ERROR: release not found: ${target}" >&2
    echo "Kept:" >&2
    cat "${base}/release-history" 2>/dev/null >&2 || ls "${base}/releases" >&2
    return 1
  fi
  local cur=""
  cur="$(readlink "${base}/current" 2>/dev/null | sed 's|^releases/||' || true)"
  if [[ -n "$cur" && "$cur" != "$target" ]]; then
    ln -sfn "releases/${cur}" "${base}/previous"
  fi
  ln -sfn "releases/${target}" "${base}/current"
  vps_rewrite_systemd_to_current "$base"
  echo "rolled_back_to=${target} previous=$(readlink "${base}/previous" 2>/dev/null || echo '?')"
}
