/**
 * Closed BREAKDOWN calls with no parts used — visit remarks from CRM.
 *
 *   npx tsx scripts/ops/export-closed-breakdown-no-parts.ts [start] [end]
 *   defaults: 2026-09-01 .. 2026-10-12 (inclusive, IST calendar days on dsolvedatetime)
 */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

config({ path: '.env.local' });
config({ path: '.env' });

import { postQuery } from '@/lib/db/proxy';
import { escapeCsvCell } from '@/lib/utils/csv';

const start = process.argv[2]?.trim() || '2026-09-01';
const end = process.argv[3]?.trim() || '2026-10-12';

type Row = Record<string, string | null | undefined>;

const HEADERS = [
  'vtrnno',
  'ncode',
  'nofficeid',
  'branch',
  'customer',
  'engineer',
  'logged_at',
  'closed_at',
  'solve_remarks',
  'visit_trn',
  'visit_at',
  'visit_technician',
  'visit_remark',
  'customer_remarks',
  'parts_replaced_details',
] as const;

function closedFlag(col: string): string {
  return `(${col} = 1 OR ${col} = '1' OR ${col} = 'True')`;
}

function dayChunks(from: string, to: string, days: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const endDt = new Date(`${to}T00:00:00Z`);
  while (cur <= endDt) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + days - 1);
    if (chunkEnd > endDt) chunkEnd.setTime(endDt.getTime());
    out.push({
      from: cur.toISOString().slice(0, 10),
      to: chunkEnd.toISOString().slice(0, 10),
    });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function sqlForRange(from: string, to: string): string {
  return `
SELECT
  tc.vtrnno,
  tc.ncode,
  tc.nofficeid,
  o.vcompanyname AS branch,
  p.vname AS customer,
  u.vname AS engineer,
  CONVERT(varchar(30), tc.dtrndate, 126) AS logged_at,
  CONVERT(varchar(30), tc.dsolvedatetime, 126) AS closed_at,
  tc.vsolveremarks AS solve_remarks,
  v.vVisitTrnNo AS visit_trn,
  CONVERT(varchar(30), v.dvisitdatetime, 126) AS visit_at,
  vu.vname AS visit_technician,
  v.vvisitremark AS visit_remark,
  v.vcustomerRemarks AS customer_remarks,
  v.vPartsReplacedDetails AS parts_replaced_details
FROM trhcalls tc (NOLOCK)
INNER JOIN mstfixedselection calltype_fs (NOLOCK)
  ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
LEFT JOIN trdcalls1visit v (NOLOCK)
  ON v.ncalls = tc.ncode AND v.nofficeid = tc.nofficeid
LEFT JOIN mstusers vu (NOLOCK) ON v.nvisitby = vu.ncode
WHERE tc.dsolvedatetime >= '${from}'
  AND tc.dsolvedatetime <= '${to} 23:59:59'
  AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
  AND ${closedFlag('tc.bsolved')}
  AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)
  AND ISNULL(tc.vtransfercallno, '') = ''
  AND NOT EXISTS (
    SELECT 1
    FROM trdcalls3parts pt (NOLOCK)
    WHERE pt.ncalls = tc.ncode AND pt.nofficeid = tc.nofficeid
  )
ORDER BY tc.dsolvedatetime, tc.ncode, v.dvisitdatetime
`.trim();
}

async function main() {
  const chunks = dayChunks(start, end, 3);
  const rows: Row[] = [];
  console.log(`CRM export closed BREAKDOWN, no parts, ${start}..${end} (${chunks.length} chunks)`);

  for (const chunk of chunks) {
    process.stdout.write(`  ${chunk.from}..${chunk.to}… `);
    const res = await postQuery({
      rawSql: sqlForRange(chunk.from, chunk.to),
      timeoutMs: 300_000,
    });
    const batch = (res.data ?? []) as Row[];
    rows.push(...batch);
    console.log(`${batch.length} rows (total ${rows.length})`);
  }

  const lines = [
    HEADERS.join(','),
    ...rows.map((r) => HEADERS.map((h) => escapeCsvCell(r[h] ?? '')).join(',')),
  ];
  const outDir = join(process.cwd(), 'tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `closed-breakdown-no-parts-${start}_to_${end}.csv`);
  writeFileSync(outPath, lines.join('\r\n'), 'utf8');
  console.log(`Wrote ${rows.length} rows → ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
