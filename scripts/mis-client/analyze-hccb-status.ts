import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { parseImportFile } from '@/features/mis-import/services/detect-parse';
import { normalizeClientRows } from '@/features/mis-import/services/normalize';
import { loadSourceConfigByCode } from '@/features/mis-import/services/config';

const path = process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/HCCB.xlsx';

async function main() {
  const buf = readFileSync(path);
  const cokeConfig = await loadSourceConfigByCode('coke');
  if (!cokeConfig) throw new Error('no coke config');

  const parsed = await parseImportFile(buf, 'HCCB.xlsx', cokeConfig);
  const rawRows = parsed.rawRows;
  console.log('raw rows:', rawRows.length, 'header row:', parsed.detectedHeaderRow);

  const byStatus = new Map<string, number>();
  for (const r of rawRows) {
    const s = (r['Call Status'] ?? r['CallStatus'] ?? '').trim() || '(empty)';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  console.log('\nRaw Call Status counts:');
  for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}\t${k}`);
  }

  const { rows, errors, warnings } = normalizeClientRows(cokeConfig, rawRows);
  console.log('\nnormalized:', rows.length, 'errors:', errors.length);
  if (warnings.length) console.log('warnings:', warnings);

  const byBucket = new Map<string, number>();
  for (const r of rows) {
    byBucket.set(r.status_bucket, (byBucket.get(r.status_bucket) ?? 0) + 1);
  }
  console.log('buckets:', Object.fromEntries(byBucket));

  const nonAssigned = rows.filter((r) => r.status_bucket !== 'assigned');
  if (nonAssigned.length) {
    console.log('\nNon-assigned imported as other buckets:');
    for (const r of nonAssigned.slice(0, 20)) {
      console.log(`  ${r.call_key}\t${r.raw['Call Status']}\t→ ${r.status_bucket}`);
    }
  }

  const openRaw = rawRows.filter(
    (r) => (r['Call Status'] ?? '').trim() === 'Open'
  );
  if (openRaw.length) {
    console.log(`\n'Open' status rows (${openRaw.length}) — also map to assigned:`);
    for (const r of openRaw.slice(0, 10)) {
      console.log(`  ${r['Call No']}\t${r['Entity Name']}`);
    }
  }

  if (errors.length) {
    console.log('\nErrors (unknown status):');
    for (const e of errors.slice(0, 20)) {
      const raw = rawRows[e.row - 2];
      console.log(`  row ${e.row}: ${e.message} | status=${raw?.['Call Status']}`);
    }
  }

  const start = new Date('2026-01-01');
  const end = new Date('2026-06-29T23:59:59');
  const inRange = rows.filter((r) => r.logged_at && r.logged_at >= start && r.logged_at <= end);
  const openInRange = inRange.filter(
    (r) => r.status_bucket === 'assigned' || r.status_bucket === 'open_unallocated'
  );
  console.log(`\nYTD–Jun29: ${inRange.length} rows, open/assigned: ${openInRange.length}`);
  const openByRaw = new Map<string, number>();
  for (const r of openInRange) {
    const s = String(r.raw['Call Status'] ?? '').trim();
    openByRaw.set(s, (openByRaw.get(s) ?? 0) + 1);
  }
  console.log('Open in range by raw status:', Object.fromEntries(openByRaw));

  const assignish = rawRows.filter((r) => /assign/i.test(r['Call Status'] ?? ''));
  const assignStatuses = new Map<string, number>();
  for (const r of assignish) {
    const s = (r['Call Status'] ?? '').trim();
    assignStatuses.set(s, (assignStatuses.get(s) ?? 0) + 1);
  }
  console.log('\nAll assign-ish raw statuses:', Object.fromEntries(assignStatuses));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
