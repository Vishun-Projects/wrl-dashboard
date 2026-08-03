/**
 * Full read-model audit: compare every CRM-derived row/column in Postgres vs live CRM.
 *
 *   npx tsx scripts/ops/audit-read-model-full.ts              # report only
 *   npx tsx scripts/ops/audit-read-model-full.ts --apply      # fix drift from CRM
 *   npx tsx scripts/ops/audit-read-model-full.ts --only hot,dims,facts
 *   npx tsx scripts/ops/audit-read-model-full.ts --resume-from-trn 26F01029
 *   npx tsx scripts/ops/audit-read-model-full.ts --skip-reverse
 *
 * Reports: logs/audit/read-model-{timestamp}.json + .jsonl
 * Recommended: run monthly or after major sync incidents.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import {
  auditExitCode,
  parseAuditCliArgs,
  runFullReadModelAudit,
} from '@/lib/read-model/audit/run-full-audit';

async function main() {
  const opts = parseAuditCliArgs(process.argv.slice(2));
  const summary = await runFullReadModelAudit(opts);
  process.exitCode = auditExitCode(summary);
}

main()
  .catch((err) => {
    console.error('[audit] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
