#!/usr/bin/env bash
set -euo pipefail

ROOT="${INSTALL_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

ENV_FILE=""
if [[ -f ".env.sync-worker" ]]; then
  ENV_FILE=".env.sync-worker"
elif [[ -f ".env.mis-email" ]]; then
  ENV_FILE=".env.mis-email"
elif [[ -f ".env.local" ]]; then
  ENV_FILE=".env.local"
fi

if [[ -z "$ENV_FILE" ]]; then
  echo "No env file with DATABASE_URL found in ${ROOT}" >&2
  exit 1
fi

set -a
source <(sed 's/\r$//' "$ENV_FILE")
set +a

: "${DATABASE_URL:?DATABASE_URL is required in ${ENV_FILE}}"

psql "$DATABASE_URL" <<'SQL'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_arcp_hot_bm_approved_detail
  ON public.arcp_lines_hot (bm_approved_at DESC, ncode DESC)
  WHERE bm_approved_at IS NOT NULL AND is_rejected = false;
SQL
