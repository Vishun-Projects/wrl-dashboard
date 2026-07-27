/**
 * Match Format.xlsx CRM_Files service orders to Postgres calls_latest_hot keys.
 */
import { config } from 'dotenv';
import { join } from 'path';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { prisma } from '@/lib/db/prisma';

const FORMAT = 'C:/Users/Vishnu.Vishwakarma/Downloads/Testing/Format.xlsx';

function normKey(v: string): string {
  return v.trim().replace(/^0+/, '').toLowerCase();
}

async function main() {
  const wb = XLSX.readFile(FORMAT, { cellDates: true });
  const main = XLSX.utils.sheet_to_json(wb.Sheets['Main'], { header: 1, defval: '' }) as unknown[][];
  const header = main[0] as string[];
  const fileIdx = header.indexOf('File Name');
  const soIdx = header.indexOf('Service Order');
  

  const crmSo = new Set<string>();
  const mondelezSo = new Set<string>();
  const hccbSo = new Set<string>();

  for (let i = 1; i < main.length; i++) {
    const r = main[i] as unknown[];
    const file = String(r[fileIdx] ?? '').trim();
    const so = normKey(String(r[soIdx] ?? ''));
    if (!so) continue;
    if (file === 'CRM Files') crmSo.add(so);
    else if (file === 'Mondelez Files') mondelezSo.add(so);
    else if (file === 'HCCB Files') hccbSo.add(so);
  }

  console.log('Format service orders:', {
    crm: crmSo.size,
    mondelez: mondelezSo.size,
    hccb: hccbSo.size,
  });

  const sampleCrm = [...crmSo].slice(0, 5);
  const sampleMon = [...mondelezSo].slice(0, 5);
  console.log('Sample CRM SO:', sampleCrm);
  console.log('Sample Mondelez SO:', sampleMon);

  const crmRows = await prisma.$queryRawUnsafe<
    Array<{ vtrnno: string; vcclid: string | null; ncode: bigint; account: string }>
  >(
    `SELECT vtrnno, vcclid, ncode, account FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
     LIMIT 5000`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  let matchVtrnno = 0;
  let matchVcclid = 0;
  let matchNcode = 0;
  let matchAny = 0;
  const inCrmFiles = new Set<string>();

  for (const row of crmRows) {
    const keys = [
      normKey(row.vtrnno),
      row.vcclid ? normKey(row.vcclid) : '',
      normKey(String(row.ncode)),
    ].filter(Boolean);
    
    if (keys.some((k) => crmSo.has(k))) {
      matchAny++;
      keys.forEach((k) => inCrmFiles.add(k));
    }
    if (crmSo.has(normKey(row.vtrnno))) matchVtrnno++;
    if (row.vcclid && crmSo.has(normKey(row.vcclid))) matchVcclid++;
    if (crmSo.has(normKey(String(row.ncode)))) matchNcode++;
  }

  console.log(`\nIn sample 5000 postgres rows:`);
  console.log(`  match vtrnno: ${matchVtrnno}`);
  console.log(`  match vcclid: ${matchVcclid}`);
  console.log(`  match ncode: ${matchNcode}`);
  console.log(`  match any: ${matchAny}`);

  const allHot = await prisma.$queryRawUnsafe<
    Array<{ vtrnno: string; region: string; account: string; status_bucket: string }>
  >(
    `SELECT h.vtrnno, COALESCE(p.region_zone, upper(trim(h.region))) AS region, h.account, h.status_bucket
     FROM calls_latest_hot h
     LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  let inCrmFilesCount = 0;
  let notInCrmFiles = 0;
  const extraByRegion = new Map<string, number>();
  const extraByAccount = new Map<string, number>();
  for (const row of allHot) {
    const k = normKey(row.vtrnno);
    if (crmSo.has(k)) {
      inCrmFilesCount++;
    } else {
      notInCrmFiles++;
      const reg = String(row.region ?? '');
      extraByRegion.set(reg, (extraByRegion.get(reg) ?? 0) + 1);
      const acc = String(row.account ?? '').toLowerCase();
      extraByAccount.set(acc, (extraByAccount.get(acc) ?? 0) + 1);
    }
  }
  console.log('\nPostgres vs Format CRM_Files (vtrnno match):');
  console.log(`  in CRM_Files: ${inCrmFilesCount} (target 122608)`);
  console.log(`  NOT in CRM_Files: ${notInCrmFiles}`);
  console.log('  Extra by region:', [...extraByRegion.entries()].sort((a, b) => b[1] - a[1]));
  console.log('  Top extra accounts:', [...extraByAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));

  const allClient = await prisma.$queryRawUnsafe<Array<{ source_code: string; call_key: string }>>(
    `
    SELECT DISTINCT ON (s.code, r.call_key) s.code AS source_code, r.call_key
    FROM mis_client_import_rows r
    INNER JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
    INNER JOIN mis_client_sources s ON s.id = r.source_id
    WHERE s.code IN ('cadbury', 'coke') AND b.is_active = true
      AND r.logged_at >= $1::timestamptz AND r.logged_at <= $2::timestamptz
    `,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );

  let cadMatchMon = 0;
  let cokeMatchHccb = 0;
  for (const row of allClient) {
    const k = normKey(row.call_key);
    if (row.source_code === 'cadbury' && mondelezSo.has(k)) cadMatchMon++;
    if (row.source_code === 'coke' && hccbSo.has(k)) cokeMatchHccb++;
  }
  console.log('\nDB client call_key vs Format file SO:');
  console.log(`  cadbury keys: ${allClient.filter((r) => r.source_code === 'cadbury').length}, match Mondelez SO: ${cadMatchMon}`);
  console.log(`  coke keys: ${allClient.filter((r) => r.source_code === 'coke').length}, match HCCB SO: ${cokeMatchHccb}`);

  // Simulate disjoint union with CRM_Files filter
  const EXCEL_CRM_REGION: Record<string, number> = {
    'NORTH ZONE': 56021,
    'EAST ZONE': 11709,
    'WEST ZONE': 24798,
    'SOUTH ZONE': 30080,
  };
  const crmFilesByRegion = new Map<string, number>();
  for (const row of allHot) {
    if (!crmSo.has(normKey(row.vtrnno))) continue;
    const reg = String(row.region ?? '');
    crmFilesByRegion.set(reg, (crmFilesByRegion.get(reg) ?? 0) + 1);
  }
  console.log('\nCRM_Files subset in Postgres by region vs Excel:');
  for (const [reg, excel] of Object.entries(EXCEL_CRM_REGION)) {
    const n = crmFilesByRegion.get(reg) ?? 0;
    console.log(`  ${reg}: postgres ${n}, excel ${excel}, Δ${n - excel}`);
  }

  const cancelled = await prisma.$queryRawUnsafe<[{ n: number }]>(
    `SELECT count(*)::int AS n FROM calls_latest_hot h
     WHERE h.logged_at >= $1::timestamptz AND h.logged_at <= $2::timestamptz
       AND upper(trim(h.call_type)) = 'BREAKDOWN'
       AND h.status_bucket = 'cancelled'`,
    '2026-01-01T00:00:00',
    '2026-06-29T23:59:59'
  );
  console.log(`\nPostgres cancelled breakdown: ${cancelled[0].n}`);

  const extraStatus = { cancelled: 0, cadbury: 0, coke: 0, dealer: 0, other: 0, total: 0 };
  for (const row of allHot) {
    if (crmSo.has(normKey(row.vtrnno))) continue;
    extraStatus.total++;
    const acc = String(row.account ?? '').toLowerCase();
    if (row.status_bucket === 'cancelled') extraStatus.cancelled++;
    else if (acc === 'cadbury' || acc === 'mondelez') extraStatus.cadbury++;
    else if (acc === 'coke' || acc === 'hccb') extraStatus.coke++;
    else if (acc === 'dealer') extraStatus.dealer++;
    else extraStatus.other++;
  }
  console.log('\nExtra rows NOT in Format CRM_Files:', extraStatus);
}

main().catch(console.error);
