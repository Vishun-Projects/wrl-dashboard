#!/usr/bin/env bash
# One-shot: remove warranty OCR pipeline install + cron from the VPS.
# Usage (from laptop):
#   bash scripts/vps-hosting/teardown-warranty-ocr-vps.sh
# Or on the VPS:
#   WARRANTY_INSTALL_ROOT=/opt/warranty-pipeline bash scripts/vps-hosting/teardown-warranty-ocr-vps.sh --local

set -euo pipefail

INSTALL_ROOT="${WARRANTY_INSTALL_ROOT:-/opt/warranty-pipeline}"
VPS_HOST="${VPS_HOST:-root@api.wrl-fsm.cloud}"

remote_teardown() {
  set -euo pipefail
  root="$1"

  kill_matching_processes() {
    local pattern="$1"
    local pids=""
    pids="$(pgrep -f -- "$pattern" 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
      return 0
    fi

    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      # Avoid killing this teardown shell or its direct parent.
      if [[ "$pid" == "$$" || "$pid" == "$PPID" ]]; then
        continue
      fi
      kill "$pid" 2>/dev/null || true
    done <<< "$pids"
  }

  echo "==> Stopping any running warranty nightly/report jobs"
  kill_matching_processes "${root}/scripts/vps-hosting/warranty-nightly.sh"
  kill_matching_processes "${root}/scripts/vps-hosting/warranty-morning-report.sh"
  kill_matching_processes "run_nightly.py"

  if command -v crontab >/dev/null 2>&1; then
    echo "==> Removing warranty cron lines"
    tmp="$(mktemp)"
    crontab -l 2>/dev/null | grep -v 'warranty-nightly\|warranty-morning-report\|warranty-pipeline' >"$tmp" || true
    crontab "$tmp" || true
    rm -f "$tmp"
  fi

  if [[ -d "$root" ]]; then
    echo "==> Removing ${root}"
    rm -rf "$root"
  else
    echo "==> ${root} already absent"
  fi

  if command -v apt-get >/dev/null 2>&1; then
    echo "==> Purging OCR apt packages (tesseract-ocr, tesseract-ocr-eng)"
    DEBIAN_FRONTEND=noninteractive apt-get purge -y tesseract-ocr tesseract-ocr-eng >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get autoremove -y >/dev/null 2>&1 || true
  fi

  echo "==> Done."
}

if [[ "${1:-}" == "--local" ]]; then
  remote_teardown "$INSTALL_ROOT"
else
  echo "==> Teardown on ${VPS_HOST} (${INSTALL_ROOT})"
  ssh "$VPS_HOST" "$(declare -f remote_teardown); remote_teardown '$INSTALL_ROOT'"
fi
