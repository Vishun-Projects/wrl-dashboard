#!/usr/bin/env bash
# Flags egress-heavy Supabase/Postgres query patterns outside allowed paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
violations=0

is_allowed_client_supabase() {
  local rel="$1"
  case "$rel" in
    src/app/login/*|src/app/profile/*|src/lib/supabase/*|src/lib/auth/*|src/middleware.ts)
      return 0
      ;;
    src/app/api/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

check_client_supabase_from() {
  echo "Browser/client supabase.from() (use API routes instead):"
  local count=0
  while IFS= read -r -d '' file; do
    local rel="${file#"$ROOT"/}"
    if is_allowed_client_supabase "$rel"; then
      continue
    fi
    if rg -n '\.from\(' "$file" >/dev/null 2>&1; then
      if rg -n 'supabase\.from\(|supabaseAdmin\.from\(' "$file" >/dev/null 2>&1; then
        rg -n 'supabase\.from\(|supabaseAdmin\.from\(' "$file" || true
        count=$((count + 1))
        violations=$((violations + 1))
      fi
    fi
  done < <(find "$ROOT/src/app" "$ROOT/src/components" "$ROOT/src/contexts" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)
  if [[ "$count" -eq 0 ]]; then
    echo "  (none)"
  fi
}

check_supabase_select_star() {
  echo "Supabase select('*'):"
  local count=0
  while IFS= read -r -d '' file; do
    local rel="${file#"$ROOT"/}"
    if [[ "$rel" == src/lib/supabase/* ]]; then
      continue
    fi
    if rg -n "\.select\(\s*['\"]\\*['\"]" "$file" >/dev/null 2>&1; then
      rg -n "\.select\(\s*['\"]\\*['\"]" "$file" || true
      count=$((count + 1))
      violations=$((violations + 1))
    fi
  done < <(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)
  if [[ "$count" -eq 0 ]]; then
    echo "  (none)"
  fi
}

check_postgres_select_star() {
  echo "SELECT h.* in read-model queries:"
  local count=0
  while IFS= read -r -d '' file; do
    if rg -n 'SELECT h\.\*' "$file" >/dev/null 2>&1; then
      rg -n 'SELECT h\.\*' "$file" || true
      count=$((count + 1))
      violations=$((violations + 1))
    fi
  done < <(find "$ROOT/src/lib/read-model" -type f -name '*.ts' -print0)
  if [[ "$count" -eq 0 ]]; then
    echo "  (none)"
  fi
}

check_client_supabase_from
check_supabase_select_star
check_postgres_select_star

if [[ "$violations" -gt 0 ]]; then
  echo ""
  echo "Found $violations file(s) with disallowed egress patterns."
  exit 1
fi

echo "No disallowed egress patterns found."
