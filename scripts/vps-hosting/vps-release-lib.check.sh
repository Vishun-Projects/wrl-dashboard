#!/usr/bin/env bash
# Local self-check for vps-release-lib.sh (no VPS / systemd required).
#   bash scripts/vps-hosting/vps-release-lib.check.sh
set -euo pipefail

# Git Bash on Windows often copies instead of symlinking unless this is set
export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/vps-hosting/vps-release-lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Symlink probe (VPS is Linux; Windows without native symlinks cannot run this check)
mkdir -p "${TMP}/probe/releases/x"
if ! ln -sfn "releases/x" "${TMP}/probe/current" 2>/dev/null || [[ ! -L "${TMP}/probe/current" ]]; then
  echo "SKIP: cannot create symlinks here (VPS Linux is fine). Probe failed."
  exit 0
fi

base="${TMP}/app"
mkdir -p "${base}/src" "${base}/scripts/vps-hosting" "${base}/logs"
echo 'console.log("ok")' >"${base}/src/index.js"
echo 'digest' >"${base}/scripts/vps-hosting/mis-email-digest.sh"
echo 'env' >"${base}/.env.sync-worker"
touch "${base}/logs/sync-worker.log"

vps_migrate_flat_to_releases "$base"

[[ -L "${base}/current" ]] || { echo "FAIL: current missing"; exit 1; }
[[ -f "${base}/shared/.env.sync-worker" ]] || { echo "FAIL: shared env"; exit 1; }
[[ -d "${base}/shared/logs" ]] || { echo "FAIL: shared logs"; exit 1; }
[[ -f "${base}/current/scripts/vps-hosting/mis-email-digest.sh" ]] || { echo "FAIL: code in current"; exit 1; }

sha1="aaaa1111bbbb"
sha2="cccc2222dddd"
mkdir -p "${base}/releases/${sha1}/scripts/vps-hosting" "${base}/releases/${sha2}/scripts/vps-hosting"
echo a >"${base}/releases/${sha1}/scripts/vps-hosting/x.sh"
echo b >"${base}/releases/${sha2}/scripts/vps-hosting/x.sh"

vps_activate_release "$base" "$sha1"
[[ "$(readlink "${base}/current")" == "releases/${sha1}" ]] || { echo "FAIL: activate sha1"; exit 1; }

vps_activate_release "$base" "$sha2"
[[ "$(readlink "${base}/current")" == "releases/${sha2}" ]] || { echo "FAIL: activate sha2"; exit 1; }
[[ "$(readlink "${base}/previous")" == "releases/${sha1}" ]] || { echo "FAIL: previous sha1"; exit 1; }

vps_rollback_to "$base"
[[ "$(readlink "${base}/current")" == "releases/${sha1}" ]] || { echo "FAIL: rollback to previous"; exit 1; }

vps_activate_release "$base" "$sha2"
vps_rollback_to "$base" "$sha1"
[[ "$(readlink "${base}/current")" == "releases/${sha1}" ]] || { echo "FAIL: rollback SHA="; exit 1; }

# Prune keeps current/previous
for i in 1 2 3 4 5 6; do
  s="deadbeef000${i}"
  mkdir -p "${base}/releases/${s}"
  vps_activate_release "$base" "$s"
done
vps_prune_releases "$base" 5
count=$(find "${base}/releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
[[ "$count" -le 6 ]] || { echo "FAIL: prune left ${count} dirs"; exit 1; }

echo "OK: vps-release-lib migrate/activate/rollback/prune"
