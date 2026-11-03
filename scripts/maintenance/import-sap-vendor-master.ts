/**
 * Load SAP Vendor Master from Vend Master.xlsx (Supplier / Name 1),
 * then fill MB51 vendor_name from matched codes and rebuild the FIFO snapshot.
 *
 * Usage:
 *   npx tsx scripts/maintenance/import-sap-vendor-master.ts
 *   npx tsx scripts/maintenance/import-sap-vendor-master.ts "path/to/Vend Master.XLSX"
 *   npx tsx scripts/maintenance/import-sap-vendor-master.ts --no-backfill
 */
import { config } from 'dotenv';
import { basename, join } from 'path';
import ExcelJS from 'exceljs';

config({ path: join(process.cwd(), '.env.local') });
process.env.USE_DIRECT_DATABASE = process.env.USE_DIRECT_DATABASE || 'true';
process.env.PG_LOCK_TIMEOUT_MS = process.env.PG_LOCK_TIMEOUT_MS || '300000';

import '@/lib/read-model/bootstrap-env';
import { closePool, withAppClient } from '@/lib/read-model/db';
import { buildDefaultSnapshot } from '@/modules/mb51-aging/server/fifo-from-db';
import {
  applySapVendorMasterToMb51,
  upsertSapVendorMaster,
  type SapVendorMasterRow,
} from '@/modules/mb51-aging/server/vendor-master';

function cellText(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellText((v as { result: unknown }).result);
  }
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

async function parseVendMaster(filePath: string): Promise<SapVendorMasterRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet in vendor master file');

  const header = ws.getRow(1);
  const hdr: string[] = [];
  header.eachCell({ includeEmpty: true }, (cell, col) => {
    hdr[col - 1] = cellText(cell.value).toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  const codeIx = hdr.findIndex((h) => h === 'supplier' || h === 'vendor' || h === 'vendorcode' || h === 'suppliercode');
  const nameIx = hdr.findIndex(
    (h) => h === 'name1' || h === 'name' || h === 'vendorname' || h === 'suppliername'
  );
  const validIx = hdr.findIndex((h) => h === 'validfrom' || h === 'validfromdate');
  if (codeIx < 0 || nameIx < 0) {
    throw new Error(
      `Need Supplier + Name 1 columns. Got: ${hdr.filter(Boolean).join(' | ') || '(empty)'}`
    );
  }
  console.log(`mapped code=${codeIx} name=${nameIx} validFrom=${validIx} file=${basename(filePath)}`);

  const out: SapVendorMasterRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cellText(row.getCell(codeIx + 1).value);
    if (!code) return;
    out.push({
      vendorCode: code,
      vendorName: cellText(row.getCell(nameIx + 1).value),
      validFrom: validIx >= 0 ? cellDate(row.getCell(validIx + 1).value) : null,
    });
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--no-backfill');
  const noBackfill = process.argv.includes('--no-backfill');
  const filePath =
    args[0] || join(process.cwd(), 'Vend Master.XLSX');

  await withAppClient(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS sap_vendor_master (
        vendor_code  text PRIMARY KEY,
        vendor_name  text NOT NULL DEFAULT '',
        valid_from   date,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  const rows = await parseVendMaster(filePath);
  console.log(`parsed ${rows.length.toLocaleString('en-IN')} vendors`);

  const upserted = await withAppClient(async (c) => upsertSapVendorMaster(c, rows));
  console.log(`upserted ${upserted.toLocaleString('en-IN')}`);

  if (noBackfill) return;

  const updated = await withAppClient(async (c) => applySapVendorMasterToMb51(c));
  console.log(`mb51 rows updated ${updated.toLocaleString('en-IN')}`);

  const latest = await withAppClient(async (c) => {
    const res = await c.query<{ id: string }>(
      `SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1`
    );
    return res.rows[0]?.id ?? null;
  });
  if (latest) {
    console.log('rebuilding FIFO snapshot…');
    await buildDefaultSnapshot(latest);
    console.log('snapshot ok for', latest);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
