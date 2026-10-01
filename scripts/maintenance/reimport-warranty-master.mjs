#!/usr/bin/env node
/**
 * Load Warrantydwnlod (small → large) then FINAL.xlsx into a staging table,
 * check the load, then swap into warranty_master_items in one transaction.
 *
 *   node scripts/maintenance/reimport-warranty-master.mjs
 *   node scripts/maintenance/reimport-warranty-master.mjs --swap
 *   node scripts/maintenance/reimport-warranty-master.mjs --final
 *
 * Default skips 2022-2025 FINAL.xlsx (SheetJS cannot parse 196 MB in reasonable time).
 * --swap finishes from an existing ingest table (e.g. after Ctrl+C on FINAL).
 *
 * Reads DATABASE_URL from .env.local / .env. Does not truncate live data until checks pass.
 */
import { spawn } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const DWNLOD = 'C:\\Users\\Vishnu.Vishwakarma\\Downloads\\Warrantydwnlod';
const FINAL = join(rootDir, '2022 to 2025 FINAL.xlsx');
const NULL_END_MAX = 0.25;
const CHUNK = 1000;
const INGEST = 'public.warranty_master_items_ingest';
const SWAP_ONLY = process.argv.includes('--swap');
const WITH_FINAL = process.argv.includes('--with-final');
const FINAL_ONLY = process.argv.includes('--final') || process.argv.includes('--merge-only');

function runFinalStream() {
  const script = join(__dirname, 'import-warranty-final.py');
  const extra = process.argv.filter((a) => a === '--merge-only');
  const cmds = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  return new Promise((resolve, reject) => {
    const tryNext = (i) => {
      if (i >= cmds.length) {
        reject(new Error('Python not found (tried py / python / python3)'));
        return;
      }
      const child = spawn(cmds[i], [script, ...extra], { stdio: 'inherit', cwd: rootDir, shell: false });
      child.on('error', () => tryNext(i + 1));
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else if (code == null) tryNext(i + 1);
        else reject(new Error(`FINAL import exited ${code}`));
      });
    };
    tryNext(0);
  });
}

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const path = join(rootDir, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function normalizeHeader(h) {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cellText(val) {
  if (val == null || val === '') return null;
  const t = String(val).trim();
  return t || null;
}

function parseDateVal(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(val);
    const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
    const y = pick('year');
    const m = pick('month');
    const d = pick('day');
    return y && m && d ? `${y}-${m}-${d}` : null;
  }
  if (typeof val === 'number' && val > 30000 && val < 70000) {
    try {
      const formatted = XLSX.SSF.format('yyyy-mm-dd', val);
      return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
    } catch {
      return null;
    }
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
    const first = Number(a);
    const second = Number(b);
    if ([first, second, year].every(Number.isInteger) && year >= 1900 && year <= 2100) {
      const day = first > 12 ? first : second > 12 ? second : first;
      const month = first > 12 ? second : second > 12 ? first : second;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  if (!Number.isNaN(Number(str)) && Number(str) > 30000 && Number(str) < 70000) {
    try {
      return XLSX.SSF.format('yyyy-mm-dd', Number(str));
    } catch {
      return null;
    }
  }
  return null;
}

function calcMonths(start, end) {
  if (!start || !end) return 0;
  const [ys, ms, ds] = String(start).split('-').map(Number);
  const [ye, me, de] = String(end).split('-').map(Number);
  if (![ys, ms, ds, ye, me, de].every(Number.isFinite)) return 0;
  const next = new Date(Date.UTC(ye, me - 1, de));
  next.setUTCDate(next.getUTCDate() + 1);
  let months = (next.getUTCFullYear() - ys) * 12 + (next.getUTCMonth() + 1 - ms);
  if (next.getUTCDate() < ds) months -= 1;
  if (months <= 0) return 0;
  return Math.ceil(months / 6) * 6;
}

function warrantyDateRank(date) {
  return date ? new Date(`${date}T00:00:00Z`).getTime() : Number.NEGATIVE_INFINITY;
}

function mapSheetHeaders(rawKeys) {
  const keyMap = {};
  for (const rawKey of rawKeys) {
    const norm = normalizeHeader(rawKey);
    if (norm.includes('serial') || norm === 'vserialno' || norm === 'serialno') {
      keyMap.serial = rawKey;
    } else if (norm.includes('billingdoc') || norm.includes('invoiceno') || norm === 'billdoc') {
      keyMap.billingDoc = rawKey;
    } else if (
      norm.includes('billingdate') ||
      norm.includes('billdate') ||
      norm.includes('invoicedate') ||
      norm.includes('invdate') ||
      norm.includes('billingdt') ||
      norm.includes('billdt') ||
      norm.includes('invoicedt') ||
      norm.includes('invdt') ||
      norm.includes('docdate') ||
      norm.includes('documentdate')
    ) {
      keyMap.billingDate = rawKey;
    } else if (norm === 'groupname' || norm === 'group' || norm === 'matlgroup') {
      keyMap.groupName = rawKey;
    } else if (norm.includes('materialgroup') || norm.includes('itemgroup') || norm === 'extmaterialgrp') {
      keyMap.materialGroup = rawKey;
    } else if (norm.includes('material') || norm.includes('fgmodel') || norm.includes('model') || norm.includes('productcode')) {
      keyMap.material = rawKey;
    } else if (norm.includes('customersoldto') || norm.includes('soldto') || norm === 'customername' || norm === 'customer') {
      keyMap.customer = rawKey;
    } else if (norm.includes('customersubgroup') || norm.includes('custsubgrp') || norm.includes('cgrp1') || norm === 'subgroup') {
      keyMap.customerSubgroup = rawKey;
    } else if (norm.includes('shiptocity') || (norm.includes('city') && norm.includes('shipto'))) {
      keyMap.shipToCity = rawKey;
    } else if (norm.includes('shiptostate') || (norm.includes('state') && norm.includes('shipto'))) {
      keyMap.state = rawKey;
    } else if (
      (norm.includes('customershipto') || norm.includes('shipto') || norm.includes('consignee')) &&
      !norm.includes('city') &&
      !norm.includes('state')
    ) {
      keyMap.shipTo = rawKey;
    } else if (norm.includes('state')) {
      keyMap.state = rawKey;
    } else if (norm === 'city') {
      keyMap.shipToCity = rawKey;
    } else if (norm.includes('inventory')) {
      keyMap.inventory = rawKey;
    } else if (norm.includes('warrda') || norm.includes('warrstart') || norm.includes('startdate')) {
      keyMap.warrStart = rawKey;
    } else if (norm.includes('wtyend') || norm.includes('warrend') || norm.includes('enddate')) {
      keyMap.warrEnd = rawKey;
    } else if (norm.includes('pincode') || norm.includes('pin') || norm.includes('zip')) {
      keyMap.pin = rawKey;
    }
  }
  return keyMap;
}

function listSourceFiles() {
  const files = [];
  if (existsSync(DWNLOD)) {
    for (const name of readdirSync(DWNLOD)) {
      if (!/\.(xlsx|xls)$/i.test(name)) continue;
      const path = join(DWNLOD, name);
      files.push({ path, size: statSync(path).size, name });
    }
    files.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  }
  if (WITH_FINAL && existsSync(FINAL)) {
    files.push({ path: FINAL, size: statSync(FINAL).size, name: '2022 to 2025 FINAL.xlsx' });
  }
  return files;
}

function clampUsedRange(ws) {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  if (range.e.c > 20) {
    range.e.c = 14;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
}

function parseWorkbook(filePath) {
  console.log('  reading file into memory...');
  const buf = readFileSync(filePath);
  console.log(`  parsed zip (${(buf.length / 1024 / 1024).toFixed(1)} MB), opening workbook...`);
  const wb = XLSX.read(buf, { cellDates: true });
  console.log(`  sheets: ${wb.SheetNames.join(', ')}`);
  const rowsBySerial = new Map();

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    clampUsedRange(sheet);
    console.log(`  sheet ${sheetName}: converting rows...`);
    const rawRows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
    if (!rawRows.length) continue;
    console.log(`  sheet ${sheetName}: ${rawRows.length} rows`);

    const keyMap = mapSheetHeaders(Object.keys(rawRows[0] ?? {}));
    if (!keyMap.serial) {
      console.warn(`  No serial column in sheet: ${sheetName}`);
      continue;
    }

    for (const r of rawRows) {
      const serial = cellText(r[keyMap.serial]);
      if (!serial) continue;
      const warrStartDt = keyMap.warrStart ? parseDateVal(r[keyMap.warrStart]) : null;
      const warrEndDt = keyMap.warrEnd ? parseDateVal(r[keyMap.warrEnd]) : null;
      const candidate = {
        serialNo: serial,
        billingDoc: keyMap.billingDoc ? cellText(r[keyMap.billingDoc]) : null,
        billingDate: keyMap.billingDate ? parseDateVal(r[keyMap.billingDate]) : null,
        material: keyMap.material ? cellText(r[keyMap.material]) : null,
        groupName: keyMap.groupName ? cellText(r[keyMap.groupName]) : null,
        materialGroup: keyMap.materialGroup ? cellText(r[keyMap.materialGroup]) : null,
        customerName: keyMap.customer ? cellText(r[keyMap.customer]) : null,
        customerSubgroup: keyMap.customerSubgroup ? cellText(r[keyMap.customerSubgroup]) : null,
        shipToParty: keyMap.shipTo ? cellText(r[keyMap.shipTo]) : null,
        shipToState: keyMap.state ? cellText(r[keyMap.state]) : null,
        shipToCity: keyMap.shipToCity ? cellText(r[keyMap.shipToCity]) : null,
        inventoryNumber: keyMap.inventory ? cellText(r[keyMap.inventory]) : null,
        warrStartDt,
        warrEndDt,
        pinCode: keyMap.pin ? cellText(r[keyMap.pin]) : null,
        warrantyMonths: calcMonths(warrStartDt, warrEndDt),
      };
      const current = rowsBySerial.get(serial);
      if (!current || warrantyDateRank(candidate.warrEndDt) >= warrantyDateRank(current.warrEndDt)) {
        rowsBySerial.set(serial, candidate);
      }
    }
  }

  return rowsBySerial;
}

async function upsertIngest(client, rows) {
  const today = new Date().toISOString().slice(0, 10);
  let written = 0;
  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const values = [];
    const placeholders = slice.map((row, j) => {
      const p = j * 17;
      values.push(
        row.serialNo,
        row.billingDoc,
        row.billingDate,
        row.material,
        row.groupName,
        row.materialGroup,
        row.customerName,
        row.customerSubgroup,
        row.shipToParty,
        row.shipToState,
        row.shipToCity,
        row.inventoryNumber,
        row.warrStartDt,
        row.warrEndDt,
        row.pinCode,
        row.warrantyMonths,
        Boolean(row.warrEndDt && row.warrEndDt >= today)
      );
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}, $${p + 14}, $${p + 15}, $${p + 16}, $${p + 17})`;
    });
    await client.query(
      `
      INSERT INTO ${INGEST} (
        serial_no, billing_doc, billing_date, material,
        group_name, material_group, customer_name,
        customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
        inventory_number, warr_start_dt, warr_end_dt, pin_code,
        warranty_months, is_active
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (serial_no) DO UPDATE SET
        billing_doc = COALESCE(EXCLUDED.billing_doc, warranty_master_items_ingest.billing_doc),
        billing_date = COALESCE(EXCLUDED.billing_date, warranty_master_items_ingest.billing_date),
        material = COALESCE(EXCLUDED.material, warranty_master_items_ingest.material),
        group_name = COALESCE(EXCLUDED.group_name, warranty_master_items_ingest.group_name),
        material_group = COALESCE(EXCLUDED.material_group, warranty_master_items_ingest.material_group),
        customer_name = COALESCE(EXCLUDED.customer_name, warranty_master_items_ingest.customer_name),
        customer_subgroup = COALESCE(EXCLUDED.customer_subgroup, warranty_master_items_ingest.customer_subgroup),
        ship_to_party = COALESCE(EXCLUDED.ship_to_party, warranty_master_items_ingest.ship_to_party),
        ship_to_state = COALESCE(EXCLUDED.ship_to_state, warranty_master_items_ingest.ship_to_state),
        ship_to_city = COALESCE(EXCLUDED.ship_to_city, warranty_master_items_ingest.ship_to_city),
        inventory_number = COALESCE(EXCLUDED.inventory_number, warranty_master_items_ingest.inventory_number),
        warr_start_dt = COALESCE(EXCLUDED.warr_start_dt, warranty_master_items_ingest.warr_start_dt),
        warr_end_dt = COALESCE(EXCLUDED.warr_end_dt, warranty_master_items_ingest.warr_end_dt),
        pin_code = COALESCE(EXCLUDED.pin_code, warranty_master_items_ingest.pin_code),
        warranty_months = EXCLUDED.warranty_months,
        is_active = (COALESCE(EXCLUDED.warr_end_dt, warranty_master_items_ingest.warr_end_dt) IS NOT NULL
          AND COALESCE(EXCLUDED.warr_end_dt, warranty_master_items_ingest.warr_end_dt) >= CURRENT_DATE),
        imported_at = NOW()
      WHERE
        (warranty_master_items_ingest.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NOT NULL)
        OR (warranty_master_items_ingest.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt >= warranty_master_items_ingest.warr_end_dt)
        OR (warranty_master_items_ingest.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NULL)
      `,
      values
    );
    written += slice.length;
  }
  return written;
}

if (FINAL_ONLY) {
  try {
    await runFinalStream();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.exit(0);
}

loadEnvFiles();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required in .env.local or .env');
  process.exit(1);
}

const files = SWAP_ONLY ? [] : listSourceFiles();
if (!SWAP_ONLY && !files.length) {
  console.error('No Excel files found in Warrantydwnlod');
  process.exit(1);
}

if (!SWAP_ONLY) {
  console.log('File order (small → large; FINAL skipped unless --with-final):');
  for (const f of files) {
    console.log(`  ${(f.size / 1024 / 1024).toFixed(1)} MB  ${f.name}`);
  }
} else {
  console.log('Swap-only: using existing warranty_master_items_ingest (no Excel read)');
}

const samples = [];
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
console.log('Connected to DB');

try {
  if (!SWAP_ONLY) {
    await client.query(`DROP TABLE IF EXISTS ${INGEST}`);
    await client.query(`
      CREATE UNLOGGED TABLE ${INGEST} (
        LIKE public.warranty_master_items INCLUDING DEFAULTS
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX warranty_master_items_ingest_serial_uidx
      ON ${INGEST} (serial_no)
    `);

    for (const file of files) {
      console.log(`\nReading ${file.name}...`);
      const rows = parseWorkbook(file.path);
      console.log(`  unique serials: ${rows.size} — writing to ingest...`);

      if (samples.length < 5) {
        for (const row of rows.values()) {
          if (row.warrStartDt && row.warrEndDt) {
            samples.push({
              serial: row.serialNo,
              file: file.name,
              excelStart: row.warrStartDt,
              excelEnd: row.warrEndDt,
            });
            if (samples.length >= 5) break;
          }
        }
      }

      const written = await upsertIngest(client, rows);
      console.log(`  upserted: ${written}`);
    }
  } else {
    const exists = await client.query(`
      SELECT to_regclass('public.warranty_master_items_ingest') AS name
    `);
    if (!exists.rows[0]?.name) {
      throw new Error('Ingest table not found. Re-run without --swap to load files first.');
    }
  }

  const stats = await client.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE warr_end_dt IS NULL)::int AS null_end
    FROM ${INGEST}
  `);
  const { total, null_end } = stats.rows[0];
  const nullPct = total > 0 ? null_end / total : 1;
  console.log(`\nIngest checks:`);
  console.log(`  rows           ${total}`);
  console.log(`  null warr_end  ${null_end} (${(nullPct * 100).toFixed(1)}%)`);

  if (total <= 0) throw new Error('Ingest is empty — aborting swap');
  if (nullPct > NULL_END_MAX) {
    throw new Error(`Null warr_end_dt share ${(nullPct * 100).toFixed(1)}% exceeds ${NULL_END_MAX * 100}% — aborting swap`);
  }

  if (samples.length) {
    console.log('\nSample serials (Excel parse vs ingest):');
    for (const s of samples) {
      const q = await client.query(
        `SELECT warr_start_dt::text AS start, warr_end_dt::text AS end
         FROM ${INGEST} WHERE UPPER(serial_no) = UPPER($1)`,
        [s.serial]
      );
      const row = q.rows[0];
      console.log(
        `  ${s.serial}  excel ${s.excelStart}→${s.excelEnd}  ingest ${row?.start ?? '—'}→${row?.end ?? '—'}`
      );
    }
  }

  const liveBefore = await client.query('SELECT COUNT(*)::int AS n FROM public.warranty_master_items');
  console.log(`\nLive table before swap: ${liveBefore.rows[0].n} rows`);

  await client.query('BEGIN');
  await client.query('TRUNCATE public.warranty_master_items RESTART IDENTITY');
  await client.query(`
    INSERT INTO public.warranty_master_items (
      serial_no, billing_doc, billing_date, material,
      group_name, material_group, customer_name,
      customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
      inventory_number, warr_start_dt, warr_end_dt, pin_code,
      warranty_months, is_active, imported_at
    )
    SELECT
      serial_no, billing_doc, billing_date, material,
      group_name, material_group, customer_name,
      customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
      inventory_number, warr_start_dt, warr_end_dt, pin_code,
      warranty_months, is_active, imported_at
    FROM ${INGEST}
  `);
  await client.query(`
    UPDATE public.warranty_master_items
    SET is_active = (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
    WHERE is_active IS DISTINCT FROM (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
  `);
  await client.query(`DROP TABLE ${INGEST}`);
  await client.query('COMMIT');

  const liveAfter = await client.query('SELECT COUNT(*)::int AS n FROM public.warranty_master_items');
  console.log(`Swap complete. Live table now: ${liveAfter.rows[0].n} rows`);
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('Error — live table left unchanged:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
