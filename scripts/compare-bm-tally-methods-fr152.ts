/**
 * Compare BM total methods for franchisee 152 / April 2026.
 */
import { postQuery } from '../src/lib/db/proxy';
import {
  buildArcpClaimsGrandTotalSql,
  parseArcpGrandTotals,
} from '../src/lib/arcp-claims/query';

const FR = '152';
const START = '2026-04-01';
const END = '2026-04-30';
const TRUTHY = `ISNULL(tc.bapproval, '0') IN ('1', 'True', 'true')`;
const SERIAL_TC = `NULLIF(LTRIM(RTRIM(CAST(tc.vserialno AS VARCHAR(80)))), '')`;
const SERIAL_ARCP = `NULLIF(LTRIM(RTRIM(COALESCE(
  NULLIF(LTRIM(RTRIM(CAST(arcp.vitemserialno AS VARCHAR(80)))), ''),
  NULLIF(LTRIM(RTRIM(CAST(arcp.nitemserialno AS VARCHAR(80)))), '')
))), '')`;
const SAFE = (c: string) =>
  `TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(${c} AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT)`;
const ELIG = `arcp.nofficetype = '3' AND arcp.nofficeid = '${FR}'
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')`;

async function q1(sql: string) {
  const r = await postQuery({ rawSql: sql, timeoutMs: 120_000 });
  return (r.data?.[0] ?? {}) as Record<string, unknown>;
}

async function main() {
  console.log('Franchisee 152 · BM April 2026\n');

  const calls = await q1(`
SELECT COUNT(DISTINCT NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')) AS calls,
       COUNT(DISTINCT ${SERIAL_TC}) AS serials
FROM trhcalls tc (NOLOCK)
WHERE CAST(tc.nofficeid AS VARCHAR(50)) = '${FR}'
  AND ${TRUTHY}
  AND tc.editedon >= '${START}' AND tc.editedon <= '${END} 23:59:59'
  AND NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') IS NOT NULL
`);
  console.log('Step 1 trhcalls BM-approved:', calls);

  const wrongSerial = await q1(`
SELECT COUNT(DISTINCT arcp.ncode) AS lines,
  SUM(${SAFE('arcp.nbmapprovedamt')}) AS sum_raw_bm
FROM trdcalls10ARCP arcp (NOLOCK)
WHERE ${ELIG}
  AND ${SERIAL_ARCP} IN (
    SELECT DISTINCT ${SERIAL_TC} FROM trhcalls tc (NOLOCK)
    WHERE CAST(tc.nofficeid AS VARCHAR(50)) = '${FR}' AND ${TRUTHY}
      AND tc.editedon >= '${START}' AND tc.editedon <= '${END} 23:59:59'
      AND ${SERIAL_TC} IS NOT NULL
  )
`);
  console.log('\nWRONG (serial match — inflates):');
  console.log('  lines:', wrongSerial.lines, 'sum raw BM:', Number(wrongSerial.sum_raw_bm).toFixed(2));

  const rightCall = await q1(`
SELECT COUNT(DISTINCT arcp.ncode) AS lines,
  SUM(${SAFE('arcp.nbmapprovedamt')}) AS sum_raw_bm
FROM trdcalls10ARCP arcp (NOLOCK)
WHERE ${ELIG}
  AND NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IN (
    SELECT DISTINCT NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')
    FROM trhcalls tc (NOLOCK)
    WHERE CAST(tc.nofficeid AS VARCHAR(50)) = '${FR}' AND ${TRUTHY}
      AND tc.editedon >= '${START}' AND tc.editedon <= '${END} 23:59:59'
  )
`);
  console.log('\nCORRECT (vtrnno = vucnno from BM calls only):');
  console.log('  lines:', rightCall.lines, 'sum raw BM (all lines):', Number(rightCall.sum_raw_bm).toFixed(2));

  for (const fast of [true, false] as const) {
    const portal = parseArcpGrandTotals(
      (await q1(buildArcpClaimsGrandTotalSql({
        startDate: START,
        endDate: END,
        dateFilterColumn: 'bm_approved_at',
        franchisee: FR,
        isHod: true,
        crmUiFast: fast,
      }))) as Record<string, unknown>
    );
    console.log(`\nPORTAL tally (crmUiFast=${fast}):`);
    console.log('  lines:', portal.lineCount);
    console.log('  amount payable:', portal.amountPayable);
    console.log('  branch approved:', portal.branchApproved.toFixed(2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
