/**
 * Scan all YTD open/assigned hot rows vs CRM; optionally refresh stale TRNs.
 *
 *   npx tsx scripts/ops/reconcile-ytd-open-from-crm.ts            # audit
 *   npx tsx scripts/ops/reconcile-ytd-open-from-crm.ts --apply    # fix from CRM
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runReconcileYtdOpen } from '@/lib/read-model/reconcile-ytd-open';

const APPLY = process.argv.includes('--apply');

runReconcileYtdOpen({ apply: APPLY })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
