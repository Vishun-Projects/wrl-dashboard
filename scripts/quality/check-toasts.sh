#!/usr/bin/env bash
# Flags direct toast.info / toast.warning usage outside the central feedback module.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ALLOWED='src/lib/ui/feedback.ts'

violations=0

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  if [[ "$rel" == "$ALLOWED" ]]; then
    continue
  fi
  if rg -n 'toast\.(info|warning)\(' "$file" >/dev/null 2>&1; then
    echo "Direct toast.info/warning in $rel (use @/lib/ui/feedback or PageAlert):"
    rg -n 'toast\.(info|warning)\(' "$file" || true
    violations=$((violations + 1))
  fi
done < <(find "$ROOT/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0)

if [[ "$violations" -gt 0 ]]; then
  echo ""
  echo "Found $violations file(s) with disallowed direct toast.info/warning calls."
  exit 1
fi

echo "OK: no direct toast.info/warning outside $ALLOWED"
