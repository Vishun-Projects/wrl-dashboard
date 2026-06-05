#!/usr/bin/env bash
# Flags disallowed UI patterns outside the design-system migration allowlist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOWED_BUTTON='src/components/ui/Button.tsx'
violations=0

check_pattern() {
  local pattern="$1"
  local label="$2"
  local count=0
  while IFS= read -r -d '' file; do
    local rel="${file#"$ROOT"/}"
    if [[ "$rel" == "$ALLOWED_BUTTON" ]]; then
      continue
    fi
    if rg -n "$pattern" "$file" >/dev/null 2>&1; then
      if [[ "$count" -eq 0 ]]; then
        echo "$label:"
      fi
      rg -n "$pattern" "$file" || true
      count=$((count + 1))
      violations=$((violations + 1))
    fi
  done < <(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)
}

check_pattern 'text-\[9px\]' 'text-[9px] in TSX (use ui-text-caption / 10px minimum)'
check_pattern 'bg-\[#' 'arbitrary hex background in TSX (use @theme tokens)'
check_pattern 'text-\[#' 'arbitrary hex text in TSX (use @theme tokens)'
check_pattern 'border-\[#' 'arbitrary hex border in TSX (use @theme tokens)'
check_pattern 'slate-450|slate-650|slate-850|rose-650|teal-650' 'invalid Tailwind color steps'

if [[ "$violations" -gt 0 ]]; then
  echo ""
  echo "Found $violations file(s) with disallowed UI token patterns."
  exit 1
fi

echo "OK: no disallowed UI token patterns in src/**/*.tsx"
