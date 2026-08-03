/**
 * Refresh tech_solved hot rows from CRM (e.g. moved to closed/cancelled).
 *
 *   npx tsx scripts/ops/reconcile-tech-solved-from-crm.ts           # audit
 *   npx tsx scripts/ops/reconcile-tech-solved-from-crm.ts --apply   # fix
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runReconcileTechSolved } from '@/lib/read-model/reconcile-tech-solved';

const APPLY = process.argv.includes('--apply');

runReconcileTechSolved({ apply: APPLY })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
