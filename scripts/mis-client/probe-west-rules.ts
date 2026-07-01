import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';
import { withAppClient } from '@/lib/read-model/db';

config({ path: join(process.cwd(), '.env.local') });

const RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCrmDate(s: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
  return null;
}

function normId(s: string): string {
  return s.trim().replace(/^0+/, '').toLowerCase();
}

async function main() {
  await withAppClient(async (c) => {
    const status = await c.query(`
      SELECT
        count(*) FILTER (WHERE h.status_bucket != 'cancelled')::int AS total_nc,
        count(*) FILTER (WHERE h.status_bucket IN ('solved','tech_solved'))::int AS solved,
        count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated','assigned'))::int AS open_status,
        count(*) FILTER (WHERE h.status_bucket NOT IN ('cancelled','solved','tech_solved','open_unallocated','assigned'))::int AS other
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
    `);
    console.log('West status breakdown:', status.rows[0]);

    const westBase = `COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'`;
    const variants = [
      ['logged_at + non-cancelled', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND h.status_bucket != 'cancelled' AND ${westBase}`],
      ['logged_at + status!=cancelled label', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND lower(trim(h.status_label)) != 'cancelled' AND ${westBase}`],
      ['logged_at + exclude tech_solved from total', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND h.status_bucket NOT IN ('cancelled','tech_solved') AND ${westBase}`],
      ['crm region WEST only (no plant remap)', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND h.status_bucket != 'cancelled' AND upper(trim(h.region)) LIKE '%WEST%'`],
      ['plant remap WEST minus cadbury', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND h.status_bucket != 'cancelled' AND ${westBase} AND lower(trim(h.account)) NOT IN ('cadbury','mondelez')`],
      ['plant remap WEST minus dealer', `h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59' AND h.status_bucket != 'cancelled' AND ${westBase} AND lower(trim(h.account)) != 'dealer'`],
    ] as const;

    console.log('\nWest total variants:');
    for (const [name, where] of variants) {
      const r = await c.query<{ n: number }>(`
        SELECT count(*)::int n
        FROM calls_latest_hot h
        LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
        WHERE upper(trim(h.call_type)) = 'BREAKDOWN' AND ${where}
      `);
      console.log(`  ${name}: ${r.rows[0].n} (Δ${r.rows[0].n - 25089})`);
    }

    const north = await c.query<{ n: number }>(`
      SELECT count(*)::int n
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%NORTH%'
    `);
    console.log(`\nNorth total: ${north.rows[0].n} (excel 68355, Δ${north.rows[0].n - 68355})`);
  });

  const lines = readFileSync(join(RAW, 'CRM_WRL_MIS_Register_2026-06-30.csv'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.indexOf(n);

  const csvWest = new Set<string>();
  const csvNorth = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols[idx('Call Type')]?.toUpperCase() !== 'BREAKDOWN') continue;
    if ((cols[idx('Status')] ?? '').toLowerCase() === 'cancelled') continue;
    const d = parseCrmDate(cols[idx('Date')] ?? '');
    if (!d || d < new Date('2026-01-01') || d > new Date('2026-06-29T23:59:59')) continue;
    const id = normId(cols[idx('ID')] ?? cols[idx('Call Centre ID')] ?? '');
    const region = cols[idx('Region')] ?? '';
    if (!id) continue;
    if (region.toUpperCase().includes('WEST')) csvWest.add(id);
    if (region.toUpperCase().includes('NORTH')) csvNorth.add(id);
  }

  await withAppClient(async (c) => {
    const dbRows = await c.query<{
      vtrnno: string;
      vcclid: string | null;
      region: string;
      plant_zone: string | null;
      status_bucket: string;
      status_label: string;
      account: string;
    }>(`
      SELECT h.vtrnno, h.vcclid, upper(trim(h.region)) AS region,
             p.region_zone AS plant_zone, h.status_bucket, h.status_label, h.account
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
    `);

    const dbIds = new Set(dbRows.rows.map((r) => normId(r.vtrnno)));
    const onlyDb = dbRows.rows.filter((r) => !csvWest.has(normId(r.vtrnno)) && !(r.vcclid && csvWest.has(normId(r.vcclid))));
    const onlyCsvCount = [...csvWest].filter((id) => !dbIds.has(id)).length;

    console.log(`\nCSV west ids: ${csvWest.size}, DB west rows: ${dbRows.rows.length}`);
    console.log(`Only in DB (west): ${onlyDb.length}, only in CSV: ${onlyCsvCount}`);
    for (const r of onlyDb.slice(0, 15)) {
      console.log(`  DB-only ${r.vtrnno} region=${r.region} plant=${r.plant_zone} status=${r.status_bucket}/${r.status_label} acc=${r.account}`);
    }

    const remapped = dbRows.rows.filter((r) => r.plant_zone && !r.region.includes('WEST'));
    console.log(`\nRemapped into WEST via plant (${remapped.length}):`);
    for (const r of remapped.slice(0, 10)) {
      console.log(`  ${r.vtrnno} crm=${r.region} plant=${r.plant_zone} acc=${r.account}`);
    }
    if (remapped.length) {
      console.log(`  Remapped total contributing to +40? count=${remapped.length}`);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
