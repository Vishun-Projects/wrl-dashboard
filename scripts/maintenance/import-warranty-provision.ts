/**
 * Import Warranty Provision from Excel Binary Workbook (.xlsb).
 * Delegates to the pyxlsb streaming importer.
 *
 * Usage:
 *   npx tsx scripts/maintenance/import-warranty-provision.ts
 *   npx tsx scripts/maintenance/import-warranty-provision.ts "path/to/file.xlsb"
 *   npx tsx scripts/maintenance/import-warranty-provision.ts --sheet Data3
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const script = join(process.cwd(), 'scripts/maintenance/import-warranty-provision.py');
const args = process.argv.slice(2);

const result = spawnSync('python', [script, ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
