#!/usr/bin/env node
/**
 * Bulk-load warranty Excel files from a folder (CLI — not the browser).
 *
 *   node scripts/maintenance/import-warranty-folder.mjs --dir "C:\\path\\to\\xlsx" --replace
 *   node scripts/maintenance/import-warranty-folder.mjs --dir "./warranty-xlsx" --replace
 *
 * --replace  TRUNCATE items, drop secondary indexes, load all .xlsx/.xls, rebuild indexes + rollup
 * Without --replace: merge/upsert into existing table
 *
 * Reads DATABASE_URL from .env.local / .env
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const CHUNK = 2500;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const DIR = argValue('--dir');
const REPLACE = process.argv.includes('--replace');

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
    } else if (
      norm.includes('material') ||
      norm.includes('fgmodel') ||
      norm.includes('model') ||
      norm.includes('productcode')
    ) {
      keyMap.material = rawKey;
    } else if (
      norm.includes('customersoldto') ||
      norm.includes('soldto') ||
      norm === 'customername' ||
      norm === 'customer'
    ) {
      keyMap.customer = rawKey;
    } else if (
      norm.includes('customersubgroup') ||
      norm.includes('custsubgrp') ||
      norm.includes('cgrp1') ||
      norm === 'subgroup'
    ) {
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

function clampSheetUsedRange(sheet, maxCol = 14) {
  if (!sheet['!ref']) return;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.c > maxCol) {
    range.e.c = maxCol;
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
}

function readSheetHeaders(sheet) {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const raw = cell?.v;
    headers.push(raw == null || raw === '' ? `COL${c}` : String(raw));
  }
  return { headers, range };
}

function rowFromRaw(r, keyMap) {
  const serial = cellText(r[keyMap.serial]);
  if (!serial) return null;
  const warrStartDt = keyMap.warrStart ? parseDateVal(r[keyMap.warrStart]) : null;
  const warrEndDt = keyMap.warrEnd ? parseDateVal(r[keyMap.warrEnd]) : null;
  return {
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
}

function dedupeChunk(rows) {
  const bySerial = new Map();
  for (const row of rows) {
    const cur = bySerial.get(row.serialNo);
    if (!cur || warrantyDateRank(row.warrEndDt) >= warrantyDateRank(cur.warrEndDt)) {
      bySerial.set(row.serialNo, row);
    }
  }
  return [...bySerial.values()];
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('~$')) continue; // Excel lock/temp
    if (!/\.(xlsx|xls)$/i.test(name)) continue;
    const path = join(dir, name);
    files.push({ path, size: statSync(path).size, name });
  }
  files.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  return files;
}

async function upsertChunk(client, rows, today) {
  if (!rows.length) return 0;
  const values = [];
  const placeholders = rows.map((row, j) => {
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
    INSERT INTO public.warranty_master_items (
      serial_no, billing_doc, billing_date, material,
      group_name, material_group, customer_name,
      customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
      inventory_number, warr_start_dt, warr_end_dt, pin_code,
      warranty_months, is_active
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (serial_no) DO UPDATE SET
      billing_doc = EXCLUDED.billing_doc,
      billing_date = EXCLUDED.billing_date,
      material = EXCLUDED.material,
      group_name = EXCLUDED.group_name,
      material_group = EXCLUDED.material_group,
      customer_name = EXCLUDED.customer_name,
      customer_subgroup = EXCLUDED.customer_subgroup,
      ship_to_party = EXCLUDED.ship_to_party,
      ship_to_state = EXCLUDED.ship_to_state,
      ship_to_city = EXCLUDED.ship_to_city,
      inventory_number = EXCLUDED.inventory_number,
      warr_start_dt = EXCLUDED.warr_start_dt,
      warr_end_dt = EXCLUDED.warr_end_dt,
      pin_code = EXCLUDED.pin_code,
      warranty_months = EXCLUDED.warranty_months,
      is_active = EXCLUDED.is_active,
      imported_at = NOW()
    `,
    values
  );
  return rows.length;
}

async function importFile(client, file, today, t0) {
  console.log(`\n=== ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) ===`);
  const buf = readFileSync(file.path);
  const wb = XLSX.read(buf, { cellDates: true });
  console.log(`  parsed sheets=[${wb.SheetNames.join(', ')}] +${Date.now() - t0}ms`);

  let imported = 0;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    clampSheetUsedRange(sheet);
    const headerInfo = readSheetHeaders(sheet);
    if (!headerInfo) continue;
    const keyMap = mapSheetHeaders(headerInfo.headers);
    if (!keyMap.serial) {
      console.log(`  skip sheet ${sheetName}: no serial column`);
      continue;
    }

    const { range, headers } = headerInfo;
    const dataStart = range.s.r + 1;
    const dataEnd = range.e.r;
    if (dataEnd < dataStart) continue;

    console.log(`  sheet ${sheetName}: ~${(dataEnd - dataStart + 1).toLocaleString()} rows`);
    let sheetImported = 0;

    for (let r0 = dataStart; r0 <= dataEnd; r0 += CHUNK) {
      const r1 = Math.min(r0 + CHUNK - 1, dataEnd);
      const aoa = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
        range: { s: { r: r0, c: range.s.c }, e: { r: r1, c: range.e.c } },
      });
      const chunk = [];
      for (const arr of aoa) {
        if (!arr?.length) continue;
        const obj = {};
        for (let i = 0; i < headers.length; i++) obj[headers[i]] = arr[i] ?? null;
        const row = rowFromRaw(obj, keyMap);
        if (row) chunk.push(row);
      }
      if (!chunk.length) continue;
      const n = await upsertChunk(client, dedupeChunk(chunk), today);
      imported += n;
      sheetImported += n;
      if (sheetImported % 25000 < CHUNK || r1 >= dataEnd) {
        console.log(`  ${sheetName}: ${sheetImported.toLocaleString()} rows +${Date.now() - t0}ms`);
      }
    }
  }
  console.log(`  file done: ${imported.toLocaleString()} rows +${Date.now() - t0}ms`);
  return imported;
}

async function rebuildRollup(client) {
  console.log('\nRebuilding rollup...');
  await client.query('BEGIN');
  try {
    await client.query('TRUNCATE public.warranty_master_rollup');
    await client.query(`
      INSERT INTO public.warranty_master_rollup (
        subgroup_key, subgroup_label, group_key, group_label,
        warranty_months, material, machine_count, active_machine_count,
        min_warr_end, max_warr_end
      )
      SELECT
        LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
        MODE() WITHIN GROUP (ORDER BY COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
        LOWER(COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
        MODE() WITHIN GROUP (ORDER BY COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
        COALESCE(warranty_months, 0),
        LOWER(COALESCE(NULLIF(BTRIM(material), ''), '(Unknown)')),
        COUNT(*)::int,
        SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)::int,
        MIN(warr_end_dt),
        MAX(warr_end_dt)
      FROM public.warranty_master_items
      GROUP BY 1, 3, 5, 6
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

if (!DIR) {
  console.error('Usage: node scripts/maintenance/import-warranty-folder.mjs --dir "C:\\\\path\\\\to\\\\xlsx" --replace');
  process.exit(1);
}

loadEnvFiles();
const dir = resolve(DIR);
if (!existsSync(dir)) {
  console.error(`Folder not found: ${dir}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL required in .env.local / .env');
  process.exit(1);
}

const files = listFiles(dir);
if (!files.length) {
  console.error(`No .xlsx/.xls files in ${dir}`);
  process.exit(1);
}

console.log(`Folder: ${dir}`);
console.log(`Mode: ${REPLACE ? 'REPLACE (truncate)' : 'merge'}`);
console.log('Files (small → large):');
for (const f of files) {
  console.log(`  ${(f.size / 1024 / 1024).toFixed(1)} MB  ${f.name}`);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const t0 = Date.now();
const today = new Date().toISOString().slice(0, 10);

try {
  await client.query("SET statement_timeout = '0'");
  await client.query('SET synchronous_commit = off');
  await client.query('SET max_parallel_workers_per_gather = 0');

  if (REPLACE) {
    console.log('\nTRUNCATE warranty_master_items...');
    await client.query('TRUNCATE TABLE public.warranty_master_items RESTART IDENTITY CASCADE');
    console.log('Dropping secondary indexes...');
    await client.query(`
      DROP INDEX IF EXISTS public.idx_wm_items_serial_upper;
      DROP INDEX IF EXISTS public.idx_wm_items_customer;
      DROP INDEX IF EXISTS public.idx_wm_items_cust_subgroup;
      DROP INDEX IF EXISTS public.idx_wm_items_group;
      DROP INDEX IF EXISTS public.idx_wm_items_material;
      DROP INDEX IF EXISTS public.idx_wm_items_warr_end;
      DROP INDEX IF EXISTS public.idx_wm_items_active;
      DROP INDEX IF EXISTS public.idx_wm_items_state;
      DROP INDEX IF EXISTS public.idx_wm_items_agg;
    `);
  }

  let total = 0;
  for (const file of files) {
    total += await importFile(client, file, today, t0);
  }

  if (REPLACE) {
    console.log('\nRebuilding secondary indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wm_items_serial_upper ON public.warranty_master_items (UPPER(serial_no));
      CREATE INDEX IF NOT EXISTS idx_wm_items_customer ON public.warranty_master_items (customer_name);
      CREATE INDEX IF NOT EXISTS idx_wm_items_cust_subgroup ON public.warranty_master_items (customer_subgroup);
      CREATE INDEX IF NOT EXISTS idx_wm_items_group ON public.warranty_master_items (group_name);
      CREATE INDEX IF NOT EXISTS idx_wm_items_material ON public.warranty_master_items (material);
      CREATE INDEX IF NOT EXISTS idx_wm_items_warr_end ON public.warranty_master_items (warr_end_dt);
      CREATE INDEX IF NOT EXISTS idx_wm_items_active ON public.warranty_master_items (is_active);
      CREATE INDEX IF NOT EXISTS idx_wm_items_state ON public.warranty_master_items (ship_to_state);
      CREATE INDEX IF NOT EXISTS idx_wm_items_agg ON public.warranty_master_items (customer_name, group_name, warranty_months, material);
    `);
  }

  await client.query(`
    UPDATE public.warranty_master_items
    SET is_active = (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
    WHERE is_active IS DISTINCT FROM (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
  `);

  await rebuildRollup(client);

  const count = await client.query('SELECT COUNT(*)::int AS n FROM public.warranty_master_items');
  console.log(`\nDone. Upserted ~${total.toLocaleString()} row-ops. Live table: ${count.rows[0].n.toLocaleString()} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
