#!/usr/bin/env node
/**
 * List distinct Coke CDMS Entity Name values from an xlsx export (for seeding state mappings).
 *
 * Usage:
 *   node scripts/mis-client/extract-coke-entities.mjs [path-to-cdms.xlsx] [headerRowIndex]
 *
 * Example:
 *   node scripts/mis-client/extract-coke-entities.mjs "CDMS_CallStatus_Detailed (37).xlsx" 5
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

import XLSX from 'xlsx';


const filePath = resolve(process.cwd(), process.argv[2] ?? 'CDMS_CallStatus_Detailed (37).xlsx');
const headerRowIndex = Math.max(1, parseInt(process.argv[3] ?? '5', 10));

const buf = readFileSync(filePath);
const wb = XLSX.read(buf, { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headerRow = matrix[headerRowIndex - 1] ?? [];
const entityIdx = headerRow.indexOf('Entity Name');
if (entityIdx < 0) {
  console.error('Entity Name column not found on header row', headerRowIndex);
  process.exit(1);
}

const counts = new Map();
for (const row of matrix.slice(headerRowIndex)) {
  const name = String(row[entityIdx] ?? '').trim();
  if (!name) continue;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
console.log(`File: ${filePath}`);
console.log(`Entities: ${sorted.length}`);
for (const [name, count] of sorted) {
  console.log(`${count.toLocaleString().padStart(8)}\t${name}`);
}

console.log('\nSeed snippet (add region_override after mapping review):');
for (const [name] of sorted) {
  console.log(`    { client_state: ${JSON.stringify(name)}, plan_code: null, region_override: 'SOUTH' },`);
}
