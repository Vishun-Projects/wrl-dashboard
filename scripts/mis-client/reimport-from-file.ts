/**
 * Re-import a Coke/Cadbury file from disk (updates latest snapshot batch).
 *
 * Usage:
 *   npx tsx scripts/mis-client/reimport-from-file.ts coke "C:/path/HCCB.xlsx"
 */
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import { loadSourceConfigByCode } from '@/lib/mis-client-import/config';
import { parseImportFile } from '@/lib/mis-client-import/detect-parse';
import { normalizeClientRows } from '@/lib/mis-client-import/normalize';
import { storeImportBatch } from '@/lib/mis-client-import/store';
import { queryClientAccountSummaryFiltered } from '@/lib/mis-client-import/aggregate';
import { withAppClient } from '@/lib/read-model/db';

async function main() {
  const sourceCode = (process.argv[2] ?? 'coke').toLowerCase();
  const filePath = process.argv[3];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/mis-client/reimport-from-file.ts <coke|cadbury> <file-path>');
    process.exit(1);
  }

  const uploader = await withAppClient(async (client) => {
    const res = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM app_users ORDER BY created_at ASC LIMIT 1`
    );
    return res.rows[0] ?? null;
  });
  if (!uploader) throw new Error('No active app user for uploaded_by');

  const sourceConfig = await loadSourceConfigByCode(sourceCode);
  if (!sourceConfig) throw new Error(`Unknown source: ${sourceCode}`);

  const buf = readFileSync(filePath);
  const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? 'import.xlsx';
  const parsed = await parseImportFile(buf, fileName, sourceConfig);
  const { rows, errors, warnings } = normalizeClientRows(sourceConfig, parsed.rawRows);

  console.log(`Parsed ${parsed.rawRows.length} rows → ${rows.length} normalized, ${errors.length} errors`);
  if (warnings.length) console.log('Warnings:', warnings);
  if (errors.length) {
    console.log('First errors:', errors.slice(0, 5));
    process.exit(1);
  }

  const result = await storeImportBatch({
    sourceId: sourceConfig.id,
    sourceCode,
    uploadedBy: uploader.id,
    fileName,
    fileBuffer: buf,
    rows,
    errorCount: errors.length,
  });

  console.log(`Stored batch ${result.batchId} (${result.rowCount} rows) by ${uploader.name}`);

  const summary = await queryClientAccountSummaryFiltered({
    sourceCodes: [sourceCode],
    startDate: '2026-01-01',
    endDate: '2026-06-29',
    agingAsOf: '2026-06-29',
  });
  const open = summary.reduce((s, r) => s + r.open_calls, 0);
  const total = summary.reduce((s, r) => s + r.total_calls, 0);
  console.log(`Coke aggregate after re-import: total=${total} open=${open}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
