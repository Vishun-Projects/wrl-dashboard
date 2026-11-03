/**
 * Import Warranty Provision from Excel Binary Workbook (.xlsb) — all sheets.
 * Delegates to the pyxlsb streaming importer (SheetJS OOMs / hangs on ~90MB xlsb).
 *
 * Usage:
 *   npx tsx scripts/maintenance/import-warranty-provision.ts
 *   npx tsx scripts/maintenance/import-warranty-provision.ts "path/to/file.xlsb"
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const filePath = process.argv[2] || join(process.cwd(), 'Warranty Prov working_October26.xlsb');
const script = join(process.cwd(), 'scripts/maintenance/import-warranty-provision.py');

const result = spawnSync('python', [script, filePath], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
