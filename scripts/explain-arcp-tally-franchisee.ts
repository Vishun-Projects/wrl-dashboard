/**
 * Explain Raw BM vs tally Branch Approved for one franchisee / period.
 *
 * Usage:
 *   npx tsx scripts/explain-arcp-tally-franchisee.ts 2026-04-01 2026-04-30 bm_approved_at 152
 */
import { queryArcpClaimsDetailRows } from '../src/features/arcp/server/postgres';
import {
  applyArcpDetailExportApprovedAmounts,
  arcpDetailCallKey,
  arcpDetailLineKey,
  type ArcpClaimsDetailRow,
} from '../src/features/arcp/services/query';

const startDate = process.argv[2] || '2026-04-01';
const endDate = process.argv[3] || '2026-04-30';
const dateFilterColumn = process.argv[4] || 'bm_approved_at';
const franchisee = process.argv[5] || '152';

function amt(row: ArcpClaimsDetailRow): number {
  return Number(row.raw_nbmapprovedamt ?? row.branch_approved) || 0;
}

async function main() {
  const rows = await queryArcpClaimsDetailRows({
    startDate,
    endDate,
    dateFilterColumn,
    franchisee,
    isHod: true,
  });

  const exportRows = applyArcpDetailExportApprovedAmounts(rows);
  const sumRawAllLines = rows.reduce((s, r) => s + amt(r), 0);
  const sumTally = exportRows.reduce((s, r) => s + (Number(r.branch_approved) || 0), 0);

  const byClaim = new Map<string, ArcpClaimsDetailRow[]>();
  for (const row of rows) {
    const key = arcpDetailCallKey(row);
    const list = byClaim.get(key);
    if (list) list.push(row);
    else byClaim.set(key, [row]);
  }

  const multiClaimExamples: {
    claimKey: string;
    ucn: string;
    lines: { ncode: string; lineType: string; rawBm: number; tallyBm: number }[];
  }[] = [];

  let multiClaimCount = 0;
  for (const [claimKey, lines] of byClaim) {
    if (lines.length <= 1) continue;
    multiClaimCount += 1;
    const tallyByLine = new Map(
      exportRows.map((r) => [arcpDetailLineKey(r), Number(r.branch_approved) || 0])
    );
    if (multiClaimExamples.length < 5) {
      multiClaimExamples.push({
        claimKey,
        ucn: lines[0]?.vucnno ?? '',
        lines: lines.map((r) => ({
          ncode: r.ncode,
          lineType: r.line_type,
          rawBm: amt(r),
          tallyBm: tallyByLine.get(arcpDetailLineKey(r)) ?? 0,
        })),
      });
    }
  }

  const name = rows[0]?.franchisee_name ?? `ncode ${franchisee}`;

  console.log('');
  console.log(`Franchisee: ${name} (${franchisee})`);
  console.log(`Period: ${startDate} → ${endDate}, date basis: ${dateFilterColumn}`);
  console.log('');
  console.log('── Excel / CRM (wrong total if you SUM everything) ──');
  console.log(`  ARCP lines in range:     ${rows.length}`);
  console.log(`  SUM(Raw BM Approved):    ${sumRawAllLines.toFixed(2)}  ← often ~35,750 in Excel`);
  console.log('');
  console.log('── Portal tally (matches SAP-style claim total) ──');
  console.log(`  Unique claims (UCN):     ${byClaim.size}`);
  console.log(`  Claims with 2+ lines:    ${multiClaimCount}`);
  console.log(`  Branch Approved (tally): ${sumTally.toFixed(2)}  ← UI ~26,480`);
  console.log(`  Removed by winning-line: ${(sumRawAllLines - sumTally).toFixed(2)}`);
  console.log('');
  console.log('── How tally works ──');
  console.log('  1. Each claim = one key (UCN, or call no, or fault+office).');
  console.log('  2. CRM stores BM approved on every ARCP line (service + travel).');
  console.log('  3. Tally counts BM only on the WINNING line per claim:');
  console.log('     latest HO/BM approve date, then highest ncode.');
  console.log('  4. Amount Payable still sums ALL lines (qty).');
  console.log('');
  if (multiClaimExamples.length > 0) {
    console.log('── Sample claims where Raw BM was counted more than once ──');
    for (const ex of multiClaimExamples) {
      console.log(`  Claim ${ex.ucn || ex.claimKey}:`);
      for (const line of ex.lines) {
        console.log(
          `    ncode ${line.ncode} ${line.lineType}: raw=${line.rawBm.toFixed(2)} tally=${line.tallyBm.toFixed(2)}`
        );
      }
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
