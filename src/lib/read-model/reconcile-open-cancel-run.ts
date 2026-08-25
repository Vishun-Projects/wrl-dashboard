#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { reconcileOpenCancelDriftFromCrm } from '@/lib/read-model/reconcile-open-cancel';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf('--call-type');
  const callType = typeIdx >= 0 ? args[typeIdx + 1] : 'BREAKDOWN';
  const result = await reconcileOpenCancelDriftFromCrm({ callType });
  console.log('[reconcile-open-cancel] Complete:', result);
}

main()
  .catch((err) => {
    console.error('[reconcile-open-cancel] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
