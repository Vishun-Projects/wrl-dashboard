#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runMidnightCrmVerify } from '@/lib/read-model/midnight-crm-verify';
import { todayLocalDate } from '@/lib/read-model/dates';

function yesterdayIst(): string {
  const today = todayLocalDate();
  const [y, m, d] = today.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asOfIdx = args.indexOf('--as-of');
  const asOf =
    (asOfIdx >= 0 ? args[asOfIdx + 1] : undefined) ||
    process.env.MIDNIGHT_SYNC_AS_OF?.trim() ||
    yesterdayIst();
  const result = await runMidnightCrmVerify(asOf);
  console.log('[midnight-verify] Result:', result);
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[midnight-verify] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
