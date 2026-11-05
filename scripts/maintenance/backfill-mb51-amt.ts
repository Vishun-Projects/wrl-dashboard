/**
 * Temp one-shot: backfill mb51_aging_rows.amt_in_loc_cur from MB51 xlsx
 * (SAP "Amt.in Loc.Cur.") by matching the same fingerprint as import dedupe.
 *
 * Usage:
 *   npx tsx scripts/maintenance/backfill-mb51-amt.ts
 *   npx tsx scripts/maintenance/backfill-mb51-amt.ts path1.xlsx path2.xlsx
 */
import { config } from 'dotenv';
import { basename, join } from 'path';
import ExcelJS from 'exceljs';

config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withAppClient } from '@/lib/read-model/db';

const DAY = 86_400_000;
const EPOCH_OFFSET = 25569;
const CHUNK = 25_000;

const DEFAULT_FILES = [
  'Mb51_01.xlsx',
  'MB51_02.xlsx',
  'MB51_03.xlsx',
  'MB51_04_30092026.xlsx',
  'MB51_oct26.xlsx',
  'MB51_Oct26_1.xlsx',
  'MB51_Combined_Part1.xlsx',
  'MB51_Combined_Part2.xlsx',
];

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/[^a-z0-9]/g, '');

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

function toSerial(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 20000 && v < 100000) return Math.floor(v);
    if (v > 1e11) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY + EPOCH_OFFSET);
      }
    }
    return Math.floor(v);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / DAY + EPOCH_OFFSET);
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return toSerial((v as { result: unknown }).result);
  }
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  let match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / DAY + EPOCH_OFFSET;
  }
  match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY + EPOCH_OFFSET;
  }
  return null;
}

function parseAmt(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return parseAmt((v as { result: unknown }).result);
  }
  let s = cellText(v).replace(/\s/g, '');
  if (!s) return null;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = `-${paren[1]}`;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const COLS: Record<string, string[]> = {
  date: ['postingdate'],
  mat: ['material'],
  qty: ['quantity', 'qtyinunitofentry', 'qty'],
  uom: ['baseunitofmeasure', 'unitofentry', 'uom'],
  mov: ['movementtype'],
  text: ['text'],
  doc: ['materialdocument'],
  plant: ['plant'],
  sup: ['supplier', 'vendor'],
  amt: ['amtinloccur', 'amountinlocalcurrency', 'amtinlocalcurrency'],
};

type AmtRow = {
  dc: string;
  mv: string;
  m: string;
  mt: string;
  d: number;
  q: number;
  v: string;
  u: string;
  tx: string;
  amt: number;
};

function rowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values;
  if (!Array.isArray(values)) return [];
  return values.slice(1);
}

async function flushBatch(rows: AmtRow[]): Promise<number> {
  if (!rows.length) return 0;
  // UNNEST keeps param count at 10 (VALUES hit Postgres 65535 bind limit at ~6.5k rows).
  const dc: string[] = [];
  const mv: string[] = [];
  const m: string[] = [];
  const mt: string[] = [];
  const d: number[] = [];
  const q: number[] = [];
  const v: string[] = [];
  const u: string[] = [];
  const tx: string[] = [];
  const amt: number[] = [];
  for (const r of rows) {
    dc.push(r.dc);
    mv.push(r.mv);
    m.push(r.m);
    mt.push(r.mt);
    d.push(r.d);
    q.push(r.q);
    v.push(r.v);
    u.push(r.u);
    tx.push(r.tx);
    amt.push(r.amt);
  }
  return withAppClient(async (client) => {
    const res = await client.query(
      `
      UPDATE mb51_aging_rows r
      SET amt_in_loc_cur = v.amt
      FROM unnest(
        $1::text[], $2::text[], $3::text[], $4::text[], $5::int[],
        $6::numeric[], $7::text[], $8::text[], $9::text[], $10::numeric[]
      ) AS v(
        material_document, plant, material, movement_type,
        posting_date_serial, qty, vendor, uom, item_text, amt
      )
      WHERE r.material_document = v.material_document
        AND r.plant = v.plant
        AND r.material = v.material
        AND r.movement_type = v.movement_type
        AND r.posting_date_serial = v.posting_date_serial
        AND r.qty = v.qty
        AND r.vendor = v.vendor
        AND r.uom = v.uom
        AND r.item_text = v.item_text
        AND (r.amt_in_loc_cur IS DISTINCT FROM v.amt)
      `,
      [dc, mv, m, mt, d, q, v, u, tx, amt]
    );
    return res.rowCount ?? 0;
  });
}

async function backfillFile(filePath: string): Promise<{
  parsed: number;
  withAmt: number;
  updated: number;
  skipped: number;
}> {
  const fileName = basename(filePath);
  console.log(`\n=== ${fileName} ===`);

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  let ix: Record<string, number> | null = null;
  let skipped = 0;
  let parsed = 0;
  let withAmt = 0;
  let updated = 0;
  let buf: AmtRow[] = [];

  async function flush() {
    if (!buf.length) return;
    const chunk = buf;
    buf = [];
    const n = await flushBatch(chunk);
    updated += n;
    console.log(
      `  flushed ${chunk.length.toLocaleString('en-IN')} → updated ${n.toLocaleString('en-IN')} (total upd ${updated.toLocaleString('en-IN')})`
    );
  }

  for await (const worksheetReader of reader) {
    console.log(`  sheet ${(worksheetReader as { name?: string }).name ?? ''}`);
    for await (const row of worksheetReader) {
      const cells = rowValues(row);
      if (!ix) {
        const hdr = cells.map(norm);
        const colIx: Record<string, number> = {};
        for (const k of Object.keys(COLS)) {
          colIx[k] = -1;
          for (const alias of COLS[k]) {
            const i = hdr.indexOf(alias);
            if (i >= 0) {
              colIx[k] = i;
              break;
            }
          }
        }
        if (['date', 'mat', 'qty'].some((k) => colIx[k] < 0)) {
          if (cells.some((c) => String(c ?? '').trim())) continue;
          throw new Error(`${fileName}: missing required columns`);
        }
        if (colIx.amt < 0) {
          throw new Error(`${fileName}: Amt.in Loc.Cur. column not found`);
        }
        ix = colIx;
        console.log(`  headers ok amt@${ix.amt} text@${ix.text}`);
        continue;
      }

      const ds = toSerial(cells[ix.date]);
      if (ds == null) {
        const blank = cells.every((c) => c == null || String(c).trim() === '');
        if (!blank) skipped++;
        continue;
      }
      const qRaw = cells[ix.qty];
      const q =
        typeof qRaw === 'number' ? qRaw : Number(cellText(qRaw).replace(/,/g, ''));
      if (!Number.isFinite(q)) {
        skipped++;
        continue;
      }
      const mat = cellText(cells[ix.mat]);
      if (!mat) {
        skipped++;
        continue;
      }
      const amt = parseAmt(cells[ix.amt]);
      parsed++;
      if (amt == null) continue;
      withAmt++;
      const cell = (key: string) => (ix![key] >= 0 ? cellText(cells[ix![key]]) : '');
      buf.push({
        dc: cell('doc'),
        mv: cell('plant'),
        m: mat,
        mt: cell('mov'),
        d: ds,
        q,
        v: cell('sup'),
        u: cell('uom'),
        tx: cell('text'),
        amt,
      });
      if (buf.length >= CHUNK) await flush();
    }
    break; // first data sheet only (same as import-mb51-all)
  }

  await flush();
  console.log(
    `  done parsed=${parsed.toLocaleString('en-IN')} withAmt=${withAmt.toLocaleString('en-IN')} updated=${updated.toLocaleString('en-IN')} skipped=${skipped}`
  );
  return { parsed, withAmt, updated, skipped };
}

async function main() {
  const argv = process.argv.slice(2);
  const paths = (argv.length ? argv : DEFAULT_FILES).map((f) =>
    f.includes('/') || f.includes('\\') ? f : join(process.cwd(), f)
  );

  await withAppClient(async (client) => {
    await client.query(`
      ALTER TABLE mb51_aging_rows
        ADD COLUMN IF NOT EXISTS amt_in_loc_cur numeric(18, 2)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_item_text_amt
        ON mb51_aging_rows (upper(btrim(item_text)))
        WHERE btrim(item_text) <> '' AND amt_in_loc_cur IS NOT NULL
    `);
  });
  console.log('schema: amt_in_loc_cur ready');

  let totalUpdated = 0;
  for (const p of paths) {
    const r = await backfillFile(p);
    totalUpdated += r.updated;
  }

  const stats = await withAppClient(async (client) => {
    const res = await client.query<{
      total: string;
      with_amt: string;
      with_text_amt: string;
    }>(`
      SELECT
        count(*)::text AS total,
        count(*) FILTER (WHERE amt_in_loc_cur IS NOT NULL)::text AS with_amt,
        count(*) FILTER (
          WHERE amt_in_loc_cur IS NOT NULL AND btrim(item_text) <> ''
        )::text AS with_text_amt
      FROM mb51_aging_rows
    `);
    return res.rows[0];
  });

  console.log(`\nDB rows=${stats?.total} with_amt=${stats?.with_amt} text+amt=${stats?.with_text_amt}`);
  console.log(`backfill updates applied this run: ${totalUpdated.toLocaleString('en-IN')}`);
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
