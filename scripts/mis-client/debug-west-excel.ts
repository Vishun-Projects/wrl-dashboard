import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import XLSX from 'xlsx';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';

async function main() {
  const wb = XLSX.readFile('C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx');
  const s2 = XLSX.utils.sheet_to_json(wb.Sheets['Sheet2'], { header: 1, defval: '' }) as unknown[][];

  let west = { total: 0, solved: 0, open: 0 };
  for (let i = 2; i < s2.length; i++) {
    const r = s2[i] as unknown[];
    if (String(r[0]) !== 'West') continue;
    west.total += Number(r[2] || 0);
    west.solved += Number(r[3] || 0);
    west.open += Number(r[4] || 0);
    console.log('Sheet2', r[1], 'total', r[2], 'solved', r[3], 'open', r[4]);
  }
  console.log('\nSheet2 West sum:', west, '(Summary ref 25089)');

  const crm = await queryBdMisCrmSummary({
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  });

  const westPortal = crm.branchSummary.filter((b) => String(b.region).includes('WEST'));
  const pTotal = westPortal.reduce((s, b) => s + Number(b.total_calls), 0);
  console.log('\nPortal WEST branch total:', pTotal, 'branches:', westPortal.length);

  const westAcc = crm.accountSummary.filter((a) => String(a.region).includes('WEST'));
  console.log('\nPortal WEST accounts (top):');
  for (const a of [...westAcc].sort((x, y) => Number(y.total_calls) - Number(x.total_calls)).slice(0, 15)) {
    const open =
      Number(a.age_2) + Number(a.age_3) + Number(a.age_7) + Number(a.age_15);
    console.log(`  ${a.account}: total ${a.total_calls} solved ${a.solved_calls} open ${open}`);
  }

  // East open gap
  const eastAcc = crm.accountSummary.filter((a) => String(a.region).includes('EAST'));
  let eastOpen = 0;
  for (const a of eastAcc) {
    eastOpen += Number(a.age_2) + Number(a.age_3) + Number(a.age_7) + Number(a.age_15);
  }
  console.log('\nPortal EAST open (aging sum):', eastOpen, '(excel 1496)');

  const sum = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1, defval: '' }) as unknown[][];
  let inBranches = false;
  const excelBranches: Array<{ name: string; total: number }> = [];
  for (const r of sum) {
    const label = String(r[0] ?? '').trim();
    if (label === 'Branches') {
      inBranches = true;
      continue;
    }
    if (!inBranches) continue;
    if (!label) break;
    excelBranches.push({ name: label, total: Number(r[1] || 0) });
  }

  function normBranch(s: string) {
    return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s*-\s*/, ' - ');
  }

  const portalByName = new Map<string, { total: number; region: string }>();
  for (const b of crm.branchSummary) {
    portalByName.set(normBranch(String(b.branch_name ?? '')), {
      total: Number(b.total_calls),
      region: String(b.region),
    });
  }

  const deltas: Array<{ name: string; excel: number; portal: number; delta: number; region: string }> =
    [];
  for (const eb of excelBranches) {
    const p = portalByName.get(normBranch(eb.name));
    if (!p) {
      deltas.push({ name: eb.name, excel: eb.total, portal: 0, delta: -eb.total, region: '?' });
      continue;
    }
    const d = p.total - eb.total;
    if (d !== 0) deltas.push({ name: eb.name, excel: eb.total, portal: p.total, delta: d, region: p.region });
  }
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log('\nBranch deltas portal-excel (top 15):');
  for (const d of deltas.slice(0, 15)) {
    console.log(`  Δ${d.delta}\t${d.name}\texcel ${d.excel}\tportal ${d.portal}\t${d.region}`);
  }
  const westDelta = deltas.filter((d) => d.region.includes('WEST')).reduce((s, d) => s + d.delta, 0);
  console.log('Net WEST branch delta:', westDelta);
}

main().catch(console.error);
