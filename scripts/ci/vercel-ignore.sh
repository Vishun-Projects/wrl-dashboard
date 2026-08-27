#!/usr/bin/env bash
# Vercel ignoreCommand: exit 0 = skip build, exit 1 = proceed.
# Keep vercel.json short (schema max 256 chars).
set -euo pipefail
ref="${VERCEL_GIT_COMMIT_REF:-}"
msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"

if [[ "$ref" != "main" && "$ref" != "master" ]]; then
  echo "Skip deploy for branch $ref"
  exit 0
fi

case "$msg" in
  *'[skip ci]'*|*'[ci skip]'*|*'[skip vercel]'*)
    echo "Skip deploy: commit marked skip"
    exit 0
    ;;
esac

exit 1
