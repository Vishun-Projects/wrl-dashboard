#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runCancelledCallRegisterSync } from './sync';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const dateFrom = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
  const dateTo = toIdx >= 0 ? args[toIdx + 1] : undefined;
  const full = args.includes('--full');
  const result = await runCancelledCallRegisterSync({ dateFrom, dateTo, full });
  console.log('[cancelled-register] Complete:', result);
}

main()
  .catch((err) => {
    console.error('[cancelled-register] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
