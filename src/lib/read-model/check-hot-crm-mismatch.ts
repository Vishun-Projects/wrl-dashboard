import { withClient } from '@/lib/read-model/db';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { hotRowNeedsCrmRefresh } from '@/lib/read-model/pipeline-reconcile';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import type { HotRow } from '@/lib/read-model/types';

const SAMPLE =
  Math.max(20, Number(process.env.SYNC_HOT_MISMATCH_SAMPLE ?? 200) || 200);

/**
 * Sample open + terminal hot rows vs live CRM; log mismatches (status / is_major).
 * Returns mismatch count for CLI exit codes.
 */
export async function runHotCrmMismatchSampleCheck(opts?: {
  sample?: number;
}): Promise<{ checked: number; mismatches: number }> {
  const limit = opts?.sample ?? SAMPLE;
  const ytdStart = registerHotRetentionStart();

  const openRows = await withClient(async (client) => {
    const res = await client.query<HotRow>(
      `SELECT vtrnno, status_bucket, ncancelreason, source_editedon,
              bsolved, bfastclose, region, is_major, nengineer
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket IN ('assigned', 'open_unallocated', 'tech_solved')
       ORDER BY synced_at ASC NULLS FIRST
       LIMIT $2`,
      [`${ytdStart}T00:00:00`, Math.ceil(limit * 0.75)]
    );
    return res.rows;
  });

  const terminalRows = await withClient(async (client) => {
    const res = await client.query<HotRow>(
      `SELECT vtrnno, status_bucket, ncancelreason, source_editedon,
              bsolved, bfastclose, region, is_major, nengineer
       FROM calls_latest_hot
       WHERE logged_at >= $1::timestamptz
         AND status_bucket IN ('solved', 'cancelled')
       ORDER BY synced_at ASC NULLS FIRST
       LIMIT $2`,
      [`${ytdStart}T00:00:00`, Math.floor(limit * 0.25)]
    );
    return res.rows;
  });

  const candidates = [...openRows, ...terminalRows];
  if (!candidates.length) {
    console.log('[sync-worker] hot/CRM mismatch sample — no candidates');
    return { checked: 0, mismatches: 0 };
  }

  const hotByTrn = new Map(candidates.map((r) => [r.vtrnno, r]));
  let mismatches = 0;
  const examples: string[] = [];

  for (let i = 0; i < candidates.length; i += 40) {
    const chunk = candidates.slice(i, i + 40).map((r) => r.vtrnno);
    const crmRows = await fetchCrmRowsByTrns(chunk, { includeTransferred: true });
    const crmByTrn = new Map(
      crmRows.map((r) => [String(r.vtrnno ?? '').trim(), r] as const)
    );

    for (const trn of chunk) {
      const hot = hotByTrn.get(trn);
      if (!hot) continue;
      const crm = crmByTrn.get(trn);
      if (!crm) {
        mismatches += 1;
        if (examples.length < 10) examples.push(`${trn}: missing in CRM (orphan)`);
        continue;
      }
      const fresh = transformCrmRowToHot(crm);
      const majorDrift =
        fresh != null && Boolean(hot.is_major) !== Boolean(fresh.is_major);
      if (majorDrift || hotRowNeedsCrmRefresh(hot, crm)) {
        mismatches += 1;
        if (examples.length < 10) {
          examples.push(
            `${trn}: hot=${hot.status_bucket}/major=${hot.is_major} crm=${fresh?.status_bucket ?? '?'}/major=${fresh?.is_major ?? '?'}`
          );
        }
      }
    }
  }

  console.log(
    `[sync-worker] hot/CRM mismatch sample — checked ${candidates.length}, mismatches ${mismatches}`
  );
  for (const line of examples) {
    console.log(`[sync-worker] mismatch: ${line}`);
  }
  return { checked: candidates.length, mismatches };
}
