/**
 * Backfill nrepairtype / repair_label / is_major for hot lines missing repair
 * in an editedon window (Branch Call Approved basis).
 *
 *   npx tsx scripts/tmp-backfill-arcp-repairtype.ts [startDate] [endExclusive] [franchiseeId?]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { postQuery } from '@/lib/db/proxy';
import { withClient } from '@/lib/read-model/db';
import { processArcpRows } from '@/modules/arcp-claims/server/sync/transform';
import {
  resetArcpHotSchemaCache,
  upsertArcpRows,
} from '@/modules/arcp-claims/server/sync/upsert';
import { ARCP_SYNC_SELECT } from '@/modules/arcp-claims/server/sync/crm-fetch';

const startDate = process.argv[2] ?? '2026-08-01';
const endExclusive = process.argv[3] ?? '2026-09-01';
const franchiseeId = process.argv[4] ? Number(process.argv[4]) : null;

async function main() {
  resetArcpHotSchemaCache();
  const ncodes = await withClient(async (client) => {
    const params: unknown[] = [startDate, endExclusive];
    let franchiseeSql = '';
    if (franchiseeId != null && Number.isFinite(franchiseeId)) {
      params.push(franchiseeId);
      franchiseeSql = `AND h.nofficeid = $3`;
    }
    const res = await client.query<{ ncode: string }>(
      `
      SELECT h.ncode::text AS ncode
      FROM arcp_lines_hot h
      WHERE h.is_rejected = false
        AND NOT h.is_travel
        AND h.source_editedon IS NOT NULL
        AND h.source_editedon >= ($1::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND h.source_editedon < ($2::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND (h.nrepairtype IS NULL OR BTRIM(h.nrepairtype) = '')
        ${franchiseeSql}
      ORDER BY h.ncode
      `,
      params
    );
    return res.rows.map((r) => r.ncode);
  });

  console.log(`missing repair: ${ncodes.length} lines (${startDate}..${endExclusive})`);
  if (ncodes.length === 0) return;

  let upserted = 0;
  let withRepair = 0;
  let major = 0;
  const batchSize = 150;
  for (let i = 0; i < ncodes.length; i += batchSize) {
    const batch = ncodes.slice(i, i + batchSize);
    const list = batch.join(',');
    const rawSql = `
${ARCP_SYNC_SELECT}
WHERE arcp.ncode IN (${list})
`.trim();
    process.stdout.write(`  CRM ${i + 1}..${i + batch.length}/${ncodes.length}… `);
    try {
      const res = await postQuery({ rawSql, timeoutMs: 180_000 });
      const hot = processArcpRows((res.data ?? []) as Record<string, unknown>[]);
      withRepair += hot.filter((r) => r.nrepairtype).length;
      major += hot.filter((r) => r.is_major).length;
      const n = await withClient(async (client) => upsertArcpRows(client, hot));
      upserted += n;
      console.log(`hot=${hot.length} upserted=${n}`);
    } catch (err) {
      console.error('FAIL', err instanceof Error ? err.message : err);
    }
  }

  console.log(JSON.stringify({ startDate, endExclusive, franchiseeId, upserted, withRepair, major }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
