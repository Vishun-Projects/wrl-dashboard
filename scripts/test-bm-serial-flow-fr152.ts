/**
 * BM flow check — franchisee 152, April 2026.
 * Correct: trhcalls (bapproval + editedon) → vtrnno → ARCP vucnno.
 * Wrong (inflates to ~₹30k): matching by serial pulls lines from other calls on same serial.
 */
import { postQuery } from '../src/lib/db/proxy';
import {
  buildArcpClaimsGrandTotalSql,
  parseArcpGrandTotals,
} from '../src/features/arcp/services/query';

const FR = '152';
const START = '2026-04-01';
const END = '2026-04-30';

const TRUTHY_BAPPROVAL = `ISNULL(tc.bapproval, '0') IN ('1', 'True', 'true')`;
const VTRNNO = `NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')`;
const VUCNNO = `NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '')`;

const SAFE_FLOAT = (col: string) =>
  `TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(${col} AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT)`;

const ARCP_ELIGIBLE = `
  arcp.nofficetype = '3'
  AND arcp.nofficeid = '${FR}'
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND EXISTS (
        SELECT 1 FROM mstitemcategory ic (NOLOCK)
        WHERE CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
          AND COALESCE(NULLIF(LTRIM(RTRIM(ic.vname)), ''), NULLIF(LTRIM(RTRIM(ic.vshortname)), '')) IS NOT NULL
      )
    )
  )`;

async function q<T extends Record<string, unknown>>(label: string, sql: string, timeoutMs = 120_000) {
  const res = await postQuery({ rawSql: sql, timeoutMs });
  const rows = (res.data ?? []) as T[];
  console.log(`\n--- ${label} (${rows.length} rows) ---`);
  return rows;
}

async function main() {
  console.log(`BM call-ref flow · franchisee ${FR} · ${START} → ${END}\n`);

  const callRows = await q<{ call_no: string }>(
    'Step 1: trhcalls BM-approved calls (bapproval + editedon)',
    `
SELECT DISTINCT ${VTRNNO} AS call_no
FROM trhcalls tc (NOLOCK)
WHERE CAST(tc.nofficeid AS VARCHAR(50)) = '${FR}'
  AND ${TRUTHY_BAPPROVAL}
  AND tc.editedon >= '${START}'
  AND tc.editedon <= '${END} 23:59:59'
  AND ${VTRNNO} IS NOT NULL
ORDER BY call_no
`.trim()
  );

  const calls = callRows.map((r) => String(r.call_no).trim()).filter(Boolean);
  console.log(`Distinct BM-approved calls (vtrnno): ${calls.length}`);

  if (calls.length === 0) {
    console.log('No calls — stopping.');
    return;
  }

  const inList = calls.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

  const sumRow = await q<{
    line_count: number;
    branch_approved: number;
  }>(
    'Step 2: ARCP lines where vucnno matches those calls',
    `
SELECT
  COUNT(DISTINCT arcp.ncode) AS line_count,
  SUM(COALESCE(${SAFE_FLOAT('arcp.nbmapprovedamt')}, ${SAFE_FLOAT('arcp.napproval1amount')})) AS branch_approved
FROM trdcalls10ARCP arcp (NOLOCK)
WHERE ${ARCP_ELIGIBLE}
  AND ${VUCNNO} IN (${inList})
`.trim(),
    180_000
  );

  const t = sumRow[0] ?? {};
  console.log('\n=== TOTALS (vtrnno = vucnno, sum all lines) ===');
  console.log('ARCP lines:', t.line_count);
  console.log(
    'Sum BM on all lines: ₹',
    Number(t.branch_approved ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    '← expect ~₹26,230'
  );

  const grandRes = await postQuery({
    rawSql: buildArcpClaimsGrandTotalSql({
      startDate: START,
      endDate: END,
      dateFilterColumn: 'bm_approved_at',
      franchisee: FR,
      isHod: true,
    }),
    timeoutMs: 180_000,
  });
  const portal = parseArcpGrandTotals((grandRes.data?.[0] ?? {}) as Record<string, unknown>);
  console.log('\n--- Step 3: portal grand total SQL ---');
  console.log('\n=== PORTAL (live CRM, sum BM on all filtered lines) ===');
  console.log('Lines:', portal.lineCount);
  console.log('Amount payable: ₹', portal.amountPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
  console.log(
    'Branch approved: ₹',
    portal.branchApproved.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    '← expect ~₹26,230'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
