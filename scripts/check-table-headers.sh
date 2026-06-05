#!/usr/bin/env bash
# Flags uppercase table header styling outside allowed patterns.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOWED=(
  "src/components/ui/Badge.tsx"
  "src/components/distribution/DistributionTablePanel.tsx"
)

violations=0

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  skip=0
  for a in "${ALLOWED[@]}"; do
    if [[ "$rel" == "$a" ]]; then
      skip=1
      break
    fi
  done
  [[ "$skip" -eq 1 ]] && continue

  if rg -n 'font-semibold uppercase tracking-wider|<th[^>]*uppercase' "$file" >/dev/null 2>&1; then
    echo "Uppercase table header pattern in $rel:"
    rg -n 'font-semibold uppercase tracking-wider|<th[^>]*uppercase' "$file" || true
    violations=$((violations + 1))
  fi
done < <(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)

if [[ "$violations" -gt 0 ]]; then
  echo ""
  echo "Found $violations file(s) with disallowed uppercase table headers."
  exit 1
fi

echo "OK: no disallowed uppercase table header patterns"
