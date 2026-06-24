#!/usr/bin/env bash
# One-time VPS setup for nightly warranty pipeline.
# From Git Bash (repo root):
#   bash scripts/vps-hosting/setup-warranty-nightly.sh
# On VPS after manual copy:
#   WARRANTY_INSTALL_ROOT=/opt/warranty-pipeline bash setup-warranty-nightly.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/.env.vps-setup"
INSTALL_ROOT="${WARRANTY_INSTALL_ROOT:-/opt/warranty-pipeline}"

run_install_on_machine() {
  local root="${1:?}"
  echo "==> Installing system packages (tesseract, playwright deps)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    python3 python3-venv python3-pip \
    tesseract-ocr tesseract-ocr-eng \
    libzbar0 \
    git rsync \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
    libasound2t64 \
    libxshmfence1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    fonts-liberation ca-certificates curl \
    2>/dev/null || apt-get install -y -qq \
    python3 python3-venv python3-pip \
    tesseract-ocr tesseract-ocr-eng \
    libzbar0 git rsync fonts-liberation ca-certificates curl

  mkdir -p "${root}/scripts/vps-hosting" "${root}/logs" "${root}/reports/latest"

  if [[ ! -d "${root}/.venv" ]]; then
    echo "==> Creating Python venv"
    python3 -m venv "${root}/.venv"
  fi

  # shellcheck disable=SC1091
  source "${root}/.venv/bin/activate"
  pip install -q --upgrade pip
  if [[ -f "${root}/requirements-vps.txt" ]]; then
    echo "==> Installing Python deps (with EasyOCR for VPS)"
    pip install -q -r "${root}/requirements-vps.txt"
  else
    pip install -q -r "${root}/requirements.txt"
  fi

  echo "==> Preloading EasyOCR model (first run downloads ~100MB)"
  python - <<'PY' || echo "    EasyOCR preload skipped (optional)"
import sys
try:
    import easyocr
    easyocr.Reader(["en"], gpu=False, verbose=False)
    print("    EasyOCR ready")
except Exception as exc:
    print(f"    EasyOCR preload failed: {exc}", file=sys.stderr)
    sys.exit(1)
PY

  export PLAYWRIGHT_BROWSERS_PATH="${root}/.playwright-browsers"
  playwright install chromium
  playwright install-deps chromium 2>/dev/null || true

  chmod +x "${root}/scripts/vps-hosting/warranty-nightly.sh" 2>/dev/null || true
  chmod +x "${root}/run_nightly.py" 2>/dev/null || true

  if [[ ! -f "${root}/.env" ]]; then
    if [[ -f "${root}/scripts/vps-hosting/.env.vps-warranty.example" ]]; then
      cp "${root}/scripts/vps-hosting/.env.vps-warranty.example" "${root}/.env"
    fi
    echo "==> Created ${root}/.env — edit CRM_USER and CRM_PASS before first run"
  fi

  echo "==> Warranty pipeline ready at ${root}"
  echo "    Test: bash ${root}/scripts/vps-hosting/warranty-nightly.sh"
  echo "    Cron (1 AM IST):"
  echo "    CRON_TZ=Asia/Kolkata"
  echo "    0 1 * * * ${root}/scripts/vps-hosting/warranty-nightly.sh >> ${root}/logs/cron.log 2>&1"
}

if [[ "${1:-}" == "--local" ]]; then
  run_install_on_machine "$INSTALL_ROOT"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE} — copy from .env.vps-setup.example and fill VPS_HOST" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
VPS_HOST="${VPS_HOST:?Set VPS_HOST in .env.vps-setup}"

echo "==> Syncing warranty-pipeline to ${VPS_HOST}:${INSTALL_ROOT}"
ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}/scripts/vps-hosting'"

if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete \
    --exclude '.venv' \
    --exclude 'cache' \
    --exclude 'logs' \
    --exclude 'reports' \
    --exclude '__pycache__' \
    --exclude '.env' \
    "${ROOT}/warranty-pipeline/" "${VPS_HOST}:${INSTALL_ROOT}/"
else
  echo "    (rsync not found — using tar over ssh)"
  tar -C "${ROOT}/warranty-pipeline" -czf - \
    --exclude='.venv' \
    --exclude='cache' \
    --exclude='logs' \
    --exclude='reports' \
    --exclude='__pycache__' \
    --exclude='.env' \
    . | ssh "$VPS_HOST" "mkdir -p '${INSTALL_ROOT}' && tar -xzf - -C '${INSTALL_ROOT}'"
fi

scp "${ROOT}/scripts/vps-hosting/warranty-nightly.sh" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/warranty-nightly.sh"
scp "${ROOT}/scripts/vps-hosting/.env.vps-warranty.example" \
  "${VPS_HOST}:${INSTALL_ROOT}/scripts/vps-hosting/.env.vps-warranty.example"

echo "==> Running install on VPS"
ssh "$VPS_HOST" "INSTALL_ROOT='${INSTALL_ROOT}' bash -s" <<REMOTE
$(declare -f run_install_on_machine)
run_install_on_machine '${INSTALL_ROOT}'
REMOTE

echo ""
echo "Next steps:"
echo "  1. ssh ${VPS_HOST}"
echo "  2. nano ${INSTALL_ROOT}/.env   # set CRM_USER, CRM_PASS"
echo "  3. bash ${INSTALL_ROOT}/scripts/vps-hosting/warranty-nightly.sh"
echo "  4. crontab -e   # add 1 AM IST line from setup output"
