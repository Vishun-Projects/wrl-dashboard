#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool, withClient } from '@/lib/read-model/db';
import { CALL_PARTS_ENTITY, syncCallPartsToPostgres } from './postgres-sync';

function currentMonthCallWindow(now = new Date()): { callFrom: string; callTo: string } {
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { callFrom: `${y}-${pad(m)}-01`, callTo: `${nextY}-${pad(nextM)}-01` };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const forceFull = process.argv.includes('--full');
  if (forceFull) {
    await withClient(async (client) => {
      await client.query(`UPDATE sync_state SET last_editedon = NULL WHERE entity = $1`, [
        CALL_PARTS_ENTITY,
      ]);
    });
  }
  const watermark = await withClient(async (client) => {
    const res = await client.query<{ last_editedon: Date | null }>(
      `SELECT last_editedon FROM sync_state WHERE entity = $1`,
      [CALL_PARTS_ENTITY]
    );
    return res.rows[0]?.last_editedon ?? null;
  });
  if (!watermark) {
    const window = currentMonthCallWindow();
    console.log(
      `[call-parts-sync] Current month ${window.callFrom} .. ${window.callTo} (history cursor kept)…`
    );
    const month = await syncCallPartsToPostgres({ ...window, preserveWatermark: true });
    console.log('[call-parts-sync] Month pass:', month);
  }
  console.log(`[call-parts-sync] Starting${forceFull ? ' (full)' : ''}…`);
  const result = await syncCallPartsToPostgres({ forceFull });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[call-parts-sync] Finished in ${elapsed}s:`, result);
}

main()
  .catch((err) => {
    console.error('[call-parts-sync] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
