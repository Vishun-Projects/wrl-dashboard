/**
 * Count YTD open/assigned hot rows where CRM says cancelled.
 * Usage: npx tsx scripts/audit-crm-cancel-hot-open.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient, closePool } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { isRegisterRowCancelled } from '@/features/report/lib/search';

const YTD_START = '2026-01-01';
const BATCH = 40;
const PROGRESS_EVERY = 20;

async function main() {
  const candidates = await withAppClient(async (c) => {
    const res = await c.query<{ vtrnno: string; status_bucket: string; ncancelreason: number | null }>(
      `SELECT vtrnno, status_bucket, ncancelreason
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket IN ('assigned', 'open_unallocated')
       ORDER BY vtrnno`,
      [YTD_START]
    );
    return res.rows;
  });

  console.log(`YTD open/assigned in hot (from ${YTD_START}): ${candidates.length}`);

  let crmCancelHotOpen = 0;
  let crmSolvedHotOpen = 0;
  let noCrm = 0;
  let hotNcrMismatch = 0;
  const examples: string[] = [];

  const batches = Math.ceil(candidates.length / BATCH);
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batchIdx = i / BATCH + 1;
    if (batchIdx % PROGRESS_EVERY === 0 || batchIdx === batches) {
      console.log(`  … batch ${batchIdx}/${batches} (stale so far: ${crmCancelHotOpen})`);
    }

    const chunk = candidates.slice(i, i + BATCH);
    let crmRows: Record<string, unknown>[] = [];
    try {
      crmRows = await fetchCrmRowsByTrns(chunk.map((r) => r.vtrnno));
    } catch (err) {
      console.warn(`  batch ${batchIdx} CRM error:`, err instanceof Error ? err.message : err);
      continue;
    }

    const crmByTrn = new Map(crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r]));

    for (const hot of chunk) {
      const hotNcr = Number(hot.ncancelreason ?? 0);
      if (hotNcr !== 0 && hotNcr !== 2) hotNcrMismatch++;

      const crm = crmByTrn.get(hot.vtrnno);
      if (!crm) {
        noCrm++;
        continue;
      }

      const crmNcr = Number(crm.ncancelreason ?? 0);
      const crmCancelled = isRegisterRowCancelled(crm);

      if (crmCancelled && hot.status_bucket !== 'cancelled') {
        crmCancelHotOpen++;
        if (examples.length < 30) {
          examples.push(
            `${hot.vtrnno} hot=${hot.status_bucket}/ncr=${hotNcr} crm_ncr=${crmNcr}`
          );
        }
      } else if (
        !crmCancelled &&
        (crm.bsolved === true ||
          crm.bsolved === 1 ||
          String(crm.bsolved).toLowerCase() === 'true' ||
          String(crm.bfastclose).toLowerCase() === 'true') &&
        (hot.status_bucket === 'assigned' || hot.status_bucket === 'open_unallocated')
      ) {
        crmSolvedHotOpen++;
      }
    }
  }

  console.log('\n=== YTD audit (Jan 2026 → now) ===');
  console.log(`Total open/assigned checked:     ${candidates.length}`);
  console.log(`CRM cancelled, hot open/assigned: ${crmCancelHotOpen}`);
  console.log(`CRM solved/tech, hot open:        ${crmSolvedHotOpen}`);
  console.log(`Hot has ncancelreason (not 0/2): ${hotNcrMismatch}`);
  console.log(`No CRM row returned:             ${noCrm}`);

  if (examples.length) {
    console.log('\nExamples (CRM cancelled, hot open):');
    for (const e of examples) console.log(' ', e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
