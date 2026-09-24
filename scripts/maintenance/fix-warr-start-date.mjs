/**
 * fix-warr-start-date.mjs
 * Reads all warranty Excel files, extracts (serial → warrStartDt) pairs,
 * then bulk-updates warranty_master_items.warr_start_dt + warranty_months.
 *
 * Run: node scripts/maintenance/fix-warr-start-date.mjs
 */

import XLSX from 'xlsx';
import pg from 'pg';
import path from 'path';
import { readdirSync, existsSync, readFileSync } from 'fs';

const DB_URL =
  'postgresql://postgres.ddmapuyghfeoyajxbcjh:fVC65ldrdaejddD3@api.wrl-fsm.cloud:6543/postgres?pgbouncer=true';

const FILES = [
  // Small files first (fast feedback) → big multi-sheet file last
  ...readdirSync('C:\\Users\\Vishnu.Vishwakarma\\Downloads\\Warrantydwnlod')
    .filter((f) => /\.(xlsx|xls)$/i.test(f))
    .sort()
    .map((f) => `C:\\Users\\Vishnu.Vishwakarma\\Downloads\\Warrantydwnlod\\${f}`),
  'E:\\database\\fast-close-app\\2022 to 2025 FINAL.xlsx',
];

// ── date helpers ──────────────────────────────────────────────────────────────

function parseDateVal(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (str.length >= 10 && str[2] === '.' && str[5] === '.') {
    return `${str.slice(6, 10)}-${str.slice(3, 5)}-${str.slice(0, 2)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const slashParts = str.split(/[\/\-]/).map((p) => p.trim());
  if (slashParts.length === 3 && slashParts.every(Boolean)) {
    const [a, b, c] = slashParts;
    let year = Number(c);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const first = Number(a), second = Number(b);
    if ([first, second, year].every(Number.isInteger) && year >= 1900 && year <= 2100) {
      const day = first > 12 ? first : second > 12 ? second : first;
      const month = first > 12 ? second : second > 12 ? first : second;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12)
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (!Number.isNaN(Number(str)) && Number(str) > 30000 && Number(str) < 70000) {
    try { return XLSX.SSF.format('yyyy-mm-dd', Number(str)); } catch {
      const d = new Date((Number(str) - 25569) * 86400 * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function calcMonths(start, end) {
  if (!start || !end) return null;
  const diff = Math.round((new Date(end) - new Date(start)) / (86400 * 1000));
  const months = Math.round(diff / 30.4375);
  return months > 0 ? months : null;
}

function normalizeHeader(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── read all files ────────────────────────────────────────────────────────────

// serial → { warrStartDt, warrEndDt }
const map = new Map();

for (const filePath of FILES) {
  if (!existsSync(filePath)) { console.warn('SKIP (not found):', filePath); continue; }
  console.log('Reading:', path.basename(filePath));

  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { cellDates: true });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rawRows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: '' });
    if (!rawRows.length) continue;

    const firstRow = rawRows[0] ?? {};
    const keyMap = {};

    for (const rawKey of Object.keys(firstRow)) {
      const norm = normalizeHeader(rawKey);
      if (norm.includes('serial') || norm === 'vserialno') {
        keyMap.serial = rawKey;
      } else if (norm.includes('warrda') || norm.includes('warrstart') || norm === 'warrantystart' || norm.includes('startdate')) {
        keyMap.warrStart ??= rawKey; // first match wins
      } else if (norm.includes('wtyend') || norm.includes('warrend') || norm === 'warrantyend' || norm.includes('enddate')) {
        keyMap.warrEnd ??= rawKey;
      }
    }

    if (!keyMap.serial) { console.warn('  No serial column in sheet:', sheetName); continue; }

    for (const r of rawRows) {
      const serial = String(r[keyMap.serial] ?? '').trim().toUpperCase();
      if (!serial) continue;
      const warrStartDt = keyMap.warrStart ? parseDateVal(r[keyMap.warrStart]) : null;
      const warrEndDt   = keyMap.warrEnd   ? parseDateVal(r[keyMap.warrEnd])   : null;

      if (!warrStartDt && !warrEndDt) continue;

      const existing = map.get(serial);
      // Keep the row with the latest end date (same policy as importer)
      const existingEnd = existing?.warrEndDt ?? '';
      const candidateEnd = warrEndDt ?? '';
      if (!existing || candidateEnd >= existingEnd) {
        map.set(serial, { warrStartDt, warrEndDt });
      }
    }
  }
}

console.log(`\nTotal unique serials parsed: ${map.size}`);

// ── filter to rows that actually have a start date ────────────────────────────

const toUpdate = [];
for (const [serial, { warrStartDt, warrEndDt }] of map) {
  if (!warrStartDt) continue;
  const months = calcMonths(warrStartDt, warrEndDt);
  toUpdate.push({ serial, warrStartDt, months });
}

console.log(`Rows with a start date to push: ${toUpdate.length}`);
if (!toUpdate.length) { console.log('Nothing to do.'); process.exit(0); }

// ── bulk UPDATE via temp table ────────────────────────────────────────────────

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('Connected to DB');

try {
  await client.query('BEGIN');

  // Create a temp table, bulk-insert, then UPDATE in one join
  await client.query(`
    CREATE TEMP TABLE _fix_warr_start (
      serial_no TEXT PRIMARY KEY,
      warr_start_dt DATE,
      warranty_months INT
    ) ON COMMIT DROP
  `);

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const slice = toUpdate.slice(i, i + CHUNK);
    const values = [];
    const placeholders = slice.map((row, j) => {
      const base = j * 3;
      values.push(row.serial.toUpperCase(), row.warrStartDt, row.months);
      return `($${base + 1}, $${base + 2}::date, $${base + 3})`;
    });
    await client.query(
      `INSERT INTO _fix_warr_start (serial_no, warr_start_dt, warranty_months) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
      values
    );
    inserted += slice.length;
    process.stdout.write(`\r  Inserted ${inserted}/${toUpdate.length} into temp table...`);
  }
  console.log();

  const result = await client.query(`
    UPDATE public.warranty_master_items w
    SET
      warr_start_dt    = f.warr_start_dt,
      warranty_months  = COALESCE(f.warranty_months, w.warranty_months)
    FROM _fix_warr_start f
    WHERE UPPER(w.serial_no) = f.serial_no
      AND (
        w.warr_start_dt IS DISTINCT FROM f.warr_start_dt
        OR (f.warranty_months IS NOT NULL AND w.warranty_months IS DISTINCT FROM f.warranty_months)
      )
  `);

  await client.query('COMMIT');
  console.log(`\n✅ Updated ${result.rowCount} rows in warranty_master_items`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('❌ Error — rolled back:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
