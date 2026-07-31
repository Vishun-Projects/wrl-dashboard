#!/usr/bin/env bash
set -euo pipefail

ROOT="${INSTALL_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

npx tsx --eval "import { getArcpPostgresCoverage } from './src/modules/arcp/server/sync/coverage-query.ts'; (async () => { const data = await getArcpPostgresCoverage(true); console.log(JSON.stringify(data, null, 2)); })().catch((err) => { console.error(err); process.exit(1); });"
