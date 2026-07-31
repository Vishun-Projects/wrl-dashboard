/**
 * Compare ARCP branch totals by dedupe key (run after filters match your SAP check).
 *
 * Usage:
 *   npx tsx scripts/compare-arcp-branch-totals.ts 2026-04-01 2026-04-30 bm_approved_at [franchiseeNcode]
 */
import { queryArcpClaimsDetailRows } from '../src/features/arcp/server/postgres';
import {
  arcpDetailDedupeKey,
  type ArcpClaimsDetailRow,
} from '../src/features/arcp/services/query';

const startDate = process.argv[2] || '2026-04-01';
const endDate = process.argv[3] || '2026-04-30';
const dateFilterColumn = process.argv[4] || 'bm_approved_at';
const franchisee = process.argv[5];

function sumDeduped(
  rows: ArcpClaimsDetailRow[],
  keyFn: (r: ArcpClaimsDetailRow) => string,
  amt: (r: ArcpClaimsDetailRow) => number
): { rows: number; branch: number; travel: number } {
  const map = new Map<string, ArcpClaimsDetailRow>();
  for (const row of rows) {
    const k = keyFn(row);
    if (!map.has(k)) map.set(k, row);
  }
  let branch = 0;
  let travel = 0;
  for (const row of map.values()) {
    const v = amt(row);
    branch += v;
    if (row.line_type === 'Travel') travel += v;
  }
  return { rows: map.size, branch, travel };
}

async function main() {
  const rows = await queryArcpClaimsDetailRows({
    startDate,
    endDate,
    dateFilterColumn,
    franchisee: franchisee || undefined,
    isHod: true,
  });

  console.log(`ARCP branch comparison ${startDate} → ${endDate} (${dateFilterColumn})`);
  console.log(`  raw lines: ${rows.length}`);

  const variants: {
    label: string;
    keyFn: (r: ArcpClaimsDetailRow) => string;
    amtFn: (r: ArcpClaimsDetailRow) => number;
  }[] = [
    {
      label: 'call_no (SAP-aligned)',
      keyFn: arcpDetailDedupeKey,
      amtFn: (r) => Number(r.branch_approved) || 0,
    },
    {
      label: 'legacy vucnno',
      keyFn: (r) => {
        const u = String(r.vucnno ?? '').trim();
        return u ? `ucn:${u}` : `fault:${r.calls2fault_code}:${r.franchisee_code}`;
      },
      amtFn: (r) => Number(r.branch_approved) || 0,
    },
    {
      label: 'call_no + raw nbmapproved',
      keyFn: arcpDetailDedupeKey,
      amtFn: (r) => Number(r.raw_nbmapprovedamt ?? r.branch_approved) || 0,
    },
  ];

  for (const { label, keyFn, amtFn } of variants) {
    const t = sumDeduped(rows, keyFn, amtFn);
    console.log(
      `  ${label}: rows=${t.rows} branch=${t.branch.toFixed(2)} travel=${t.travel.toFixed(2)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
