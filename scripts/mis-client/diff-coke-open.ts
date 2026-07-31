import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { parseImportFile } from '@/modules/mis/client-import/services/detect-parse';
import { normalizeClientRows } from '@/modules/mis/client-import/services/normalize';
import { loadSourceConfigByCode } from '@/modules/mis/client-import/services/config';
import { prisma } from '@/lib/db/prisma';

const HCCB = process.argv[2] ?? 'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/HCCB.xlsx';

async function main() {
  const cokeConfig = await loadSourceConfigByCode('coke');
  if (!cokeConfig) throw new Error('no coke config');

  const buf = readFileSync(HCCB);
  const parsed = await parseImportFile(buf, 'HCCB.xlsx', cokeConfig);
  const { rows } = normalizeClientRows(cokeConfig, parsed.rawRows);

  const start = new Date('2026-01-01');
  const end = new Date('2026-06-29T23:59:59');
  const fileOpen = new Set(
    rows
      .filter(
        (r) =>
          r.logged_at &&
          r.logged_at >= start &&
          r.logged_at <= end &&
          (r.status_bucket === 'assigned' || r.status_bucket === 'open_unallocated')
      )
      .map((r) => r.call_key)
  );
  console.log('File open keys:', fileOpen.size);

  const dbOpen = await prisma.$queryRawUnsafe<
    Array<{ call_key: string; raw_status: string | null; logged: Date; file_name: string; batch_created: Date }>
  >(
    `
    SELECT r.call_key,
           COALESCE(r.raw->>'Call Status', r.raw->>'CallStatus') as raw_status,
           r.logged_at::date as logged,
           b.file_name,
           b.created_at as batch_created
    FROM (
      SELECT DISTINCT ON (r.source_id, r.call_key)
        r.*, b.file_name, b.created_at
      FROM mis_client_import_rows r
      JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
      JOIN mis_client_sources s ON s.id = r.source_id
      WHERE s.code = 'coke' AND b.status = 'completed'
        AND r.logged_at >= '2026-01-01'::date
        AND r.logged_at <= ('2026-06-29'::date + interval '1 day' - interval '1 second')
        AND r.status_bucket IN ('assigned', 'open_unallocated')
      ORDER BY r.source_id, r.call_key, b.created_at DESC
    ) r
    JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
    ORDER BY r.call_key
    `
  );
  console.log('DB open keys:', dbOpen.length);

  const dbSet = new Set(dbOpen.map((r) => r.call_key));
  const onlyDb = dbOpen.filter((r) => !fileOpen.has(r.call_key));
  const onlyFile = [...fileOpen].filter((k) => !dbSet.has(k));

  console.log('\nIn DB open but NOT in file open:', onlyDb.length);
  for (const r of onlyDb) {
    console.log(`  ${r.call_key} | ${r.raw_status} | ${r.logged} | ${r.file_name} | batch ${r.batch_created}`);
  }

  console.log('\nIn file open but NOT in DB open:', onlyFile.length);
  for (const k of onlyFile.slice(0, 20)) console.log(`  ${k}`);

  // Check if onlyDb keys exist in file with different status
  const fileByKey = new Map(rows.map((r) => [r.call_key, r]));
  console.log('\nDB-only keys in file with other status:');
  for (const r of onlyDb) {
    const fr = fileByKey.get(r.call_key);
    if (fr) {
      console.log(
        `  ${r.call_key}: file status=${fr.raw['Call Status']} bucket=${fr.status_bucket} logged=${fr.logged_at?.toISOString().slice(0, 10)}`
      );
    } else {
      console.log(`  ${r.call_key}: NOT IN FILE AT ALL`);
    }
  }

  const sample = ['7181413', '7181500', '7181990', '7182024'];
  console.log('\nAll DB rows for sample keys:');
  for (const k of sample) {
    const hist = await prisma.$queryRawUnsafe<
      Array<{ call_key: string; status_bucket: string; raw_status: string | null; file_name: string; created_at: Date }>
    >(
      `SELECT r.call_key, r.status_bucket, r.raw->>'Call Status' as raw_status, b.file_name, b.created_at
       FROM mis_client_import_rows r
       JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
       WHERE r.call_key = $1 ORDER BY b.created_at DESC`,
      k
    );
    console.log(k, hist);
  }

  console.log('\nCurrent file status for DB-only open keys:');
  for (const r of onlyDb) {
    const raw = parsed.rawRows.find((x) => String(x['Call No'] ?? '').trim() === r.call_key);
    console.log(`  ${r.call_key}: ${raw ? raw['Call Status'] ?? '(no status)' : 'MISSING FROM FILE'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
