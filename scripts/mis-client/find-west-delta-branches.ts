import { config } from 'dotenv';
import { join } from 'path';
import XLSX from 'xlsx';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { prisma } from '@/lib/db/prisma';

config({ path: join(process.cwd(), '.env.local') });

const EXCEL = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/New_BD_MIS_30.06.2026.xlsx';

function normBranch(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+branch$/i, '');
}

function officeKeyFromLabel(label: string): string | null {
  const m = /^(\d+)\s*-\s*/i.exec(label.trim());
  return m ? m[1] : null;
}

async function main() {
  const wb = XLSX.readFile(EXCEL);
  const sum = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1, defval: '' }) as unknown[][];

  let inBranches = false;
  const excelBranches: Array<{
    label: string;
    officeId: string | null;
    total: number;
    solved: number;
    open: number;
  }> = [];

  for (const r of sum) {
    const label = String(r[0] ?? '').trim();
    if (label === 'Branches') {
      inBranches = true;
      continue;
    }
    if (!inBranches) continue;
    if (!label) break;
    excelBranches.push({
      label,
      officeId: officeKeyFromLabel(label),
      total: Number(r[1] ?? 0),
      solved: Number(r[2] ?? 0),
      open: Number(r[3] ?? 0),
    });
  }

  const crm = await queryBdMisCrmSummary({
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
    callTypes: ['BREAKDOWN'],
    isHod: true,
  });

  const portalByOffice = new Map<number, (typeof crm.branchSummary)[0]>();
  const portalByName = new Map<string, (typeof crm.branchSummary)[0]>();
  for (const b of crm.branchSummary) {
    portalByOffice.set(Number(b.officeId), b);
    portalByName.set(normBranch(String(b.branch ?? '')), b);
  }

  type Delta = {
    label: string;
    officeId: string | null;
    region: string;
    excelTotal: number;
    portalTotal: number;
    dt: number;
    ds: number;
    dop: number;
    match: string;
  };

  const deltas: Delta[] = [];
  for (const eb of excelBranches) {
    let pb = eb.officeId ? portalByOffice.get(Number(eb.officeId)) : undefined;
    if (!pb) pb = portalByName.get(normBranch(eb.label));
    const region = pb ? String(pb.region) : '?';
    const pt = pb ? Number(pb.total_calls) : 0;
    const ps = pb ? Number(pb.solved_calls) : 0;
    const po = pb
      ? Number(pb.age_2) + Number(pb.age_3) + Number(pb.age_7) + Number(pb.age_15)
      : 0;
    const dt = pt - eb.total;
    const ds = ps - eb.solved;
    const dop = po - eb.open;
    if (dt || ds || dop || !pb) {
      deltas.push({
        label: eb.label,
        officeId: eb.officeId,
        region,
        excelTotal: eb.total,
        portalTotal: pt,
        dt,
        ds,
        dop,
        match: pb ? 'matched' : 'missing',
      });
    }
  }

  const west = deltas.filter((d) => d.region.includes('WEST'));
  west.sort((a, b) => Math.abs(b.dt) - Math.abs(a.dt));

  console.log(`Excel branch rows: ${excelBranches.length}`);
  console.log(`West branch mismatches: ${west.length}`);
  console.log(
    `Net WEST Δtotal ${west.reduce((s, d) => s + d.dt, 0)}, Δsolved ${west.reduce((s, d) => s + d.ds, 0)}, Δopen ${west.reduce((s, d) => s + d.dop, 0)}`
  );
  console.log('\nTop WEST branch deltas (portal - excel):');
  for (const d of west.slice(0, 25)) {
    console.log(
      `  Δt${d.dt} Δs${d.ds} Δo${d.dop} | ${d.label} | excel ${d.excelTotal} portal ${d.portalTotal} | ${d.match}`
    );
  }

  // Portal west branches not in excel list
  const excelOfficeIds = new Set(
    excelBranches.map((b) => b.officeId).filter((x): x is string => Boolean(x))
  );
  const extraWest = crm.branchSummary.filter(
    (b) =>
      String(b.region).includes('WEST') &&
      !excelOfficeIds.has(String(b.officeId)) &&
      Number(b.total_calls) > 0
  );
  const extraTotal = extraWest.reduce((s, b) => s + Number(b.total_calls), 0);
  console.log(`\nPortal WEST offices not in Excel branch list: ${extraWest.length}, total ${extraTotal}`);
  for (const b of extraWest.sort((a, b) => Number(b.total_calls) - Number(a.total_calls)).slice(0, 20)) {
    console.log(`  ${b.officeId} ${b.branch} t${b.total_calls} s${b.solved_calls}`);
  }

  // Try alternate CRM filters to see if any hits 25089
  const filters: Array<{ name: string; sql: string }> = [
    {
      name: 'current (non-cancelled)',
      sql: `h.status_bucket != 'cancelled'`,
    },
    {
      name: 'exclude cancelled status label',
      sql: `lower(trim(h.status_label)) != 'cancelled'`,
    },
    {
      name: 'exclude dealer account west',
      sql: `h.status_bucket != 'cancelled' AND lower(trim(h.account)) != 'dealer'`,
    },
    {
      name: 'parent offices only (nunder=0)',
      sql: `h.status_bucket != 'cancelled'`,
    },
  ];

  console.log('\n=== Alternate West totals ===');
  for (const f of filters) {
    let sql = `
      SELECT count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      WHERE h.logged_at >= '2026-01-01T00:00:00' AND h.logged_at <= '2026-06-29T23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
        AND ${f.sql}
    `;
    if (f.name === 'parent offices only (nunder=0)') {
      sql += ` AND COALESCE(d.nunder, 0) = 0`;
    }
    const r = await prisma.$queryRawUnsafe<Array<{ n: number }>>(sql);
    console.log(`  ${f.name}: ${r[0].n} (excel 25089, delta ${r[0].n - 25089})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
