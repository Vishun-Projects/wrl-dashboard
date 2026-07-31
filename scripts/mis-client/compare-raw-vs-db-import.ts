/**
 * Compare Raw Cadbury.csv + HCCB.xlsx row counts vs portal DB imports.
 * Prints re-import steps when drift is detected.
 *
 * Usage:
 *   npx tsx scripts/mis-client/compare-raw-vs-db-import.ts [raw-dir] [end-date]
 */
import { config } from 'dotenv';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import XLSX from 'xlsx';

config({ path: join(process.cwd(), '.env.local') });

import { queryClientAccountSummaryFiltered } from '@/modules/mis/client-import/services/aggregate';
import { sumClientCokeMetricsSouth } from '@/modules/mis/services/bd-mis-summary';
import { parseClientDate } from '@/modules/mis/client-import/services/parse-dates';
import { isCadburyExcludedServiceProvider } from '@/modules/mis/client-import/services/cadbury-filters';


const DEFAULT_RAW = 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw';

function inRange(d: Date | null, endDate: string): boolean {
  if (!d || Number.isNaN(d.getTime())) return false;
  const start = new Date('2026-01-01T00:00:00');
  const end = new Date(`${endDate}T23:59:59`);
  return d >= start && d <= end;
}

function countRawCadbury(rawDir: string, endDate: string): number {
  const path = join(rawDir, 'Cadbury.csv');
  if (!existsSync(path)) return 0;
  const text = readFileSync(path, 'utf16le').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split('|').map((h) => h.replace(/^"|"$/g, '').replace(/^\./, ''));
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('|').map((c) => c.replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cols[j] ?? '';
    });
    const d = parseClientDate(row.VDate ?? '');
    if (!inRange(d, endDate)) continue;
    if (isCadburyExcludedServiceProvider(row.Service_Provider ?? '')) continue;
    n++;
  }
  return n;
}

function countRawHccb(rawDir: string, endDate: string): number {
  const path = join(rawDir, 'HCCB.xlsx');
  if (!existsSync(path)) return 0;
  const wb = XLSX.readFile(path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: '',
    range: 4,
  });
  let n = 0;
  for (const row of rows) {
    const dateVal = row['Call Log Date'] ?? row['VDate'] ?? '';
    const d = dateVal instanceof Date ? dateVal : parseClientDate(String(dateVal));
    if (!inRange(d, endDate)) continue;
    n++;
  }
  return n;
}

async function main() {
  const rawDir = process.argv[2] ?? DEFAULT_RAW;
  const endDate = process.argv[3] ?? '2026-06-29';

  const rawCadbury = countRawCadbury(rawDir, endDate);
  const rawCoke = countRawHccb(rawDir, endDate);

  const clientAccounts = await queryClientAccountSummaryFiltered({
    startDate: '2026-01-01',
    endDate,
    agingAsOf: endDate,
    sourceCodes: ['coke', 'cadbury'],
  });

  const dbCadbury = clientAccounts
    .filter((a) => String(a.account).toLowerCase() === 'cadbury')
    .reduce((s, a) => s + Number(a.total_calls ?? 0), 0);
  const dbCoke = sumClientCokeMetricsSouth(clientAccounts).total_calls;

  console.log('=== Raw files vs portal DB import ===\n');
  console.log(`Raw dir: ${rawDir}`);
  console.log(`Date range: 2026-01-01 → ${endDate}\n`);
  console.log(`Cadbury: raw ${rawCadbury} | DB ${dbCadbury} | Δ ${dbCadbury - rawCadbury}`);
  console.log(`Coke/HCCB: raw ${rawCoke} | DB ${dbCoke} | Δ ${dbCoke - rawCoke}`);

  const drift = Math.abs(dbCadbury - rawCadbury) + Math.abs(dbCoke - rawCoke);
  if (drift > 0) {
    console.log('\nRe-import to align portal with Raw files:');
    console.log('  1. Open MIS Reports → Summary (or Client Import tab).');
    console.log('  2. Import as Cadbury → upload Cadbury.csv from Raw folder.');
    console.log('  3. Import as Coke → upload HCCB.xlsx from Raw folder.');
    console.log('  4. Set portal end date to match Excel (e.g. 30-Jun for New_BD_MIS_30.06.2026.xlsx).');
    console.log('  5. Re-run: npx tsx scripts/mis-client/reconcile-portal-excel.ts');
  } else {
    console.log('\nRaw file counts match DB imports for this date range.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
