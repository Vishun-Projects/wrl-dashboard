/**
 * Import several MB51 xlsx files into one overall import (deduped append).
 *
 * Usage:
 *   npx tsx scripts/maintenance/import-mb51-all.ts
 *   npx tsx scripts/maintenance/import-mb51-all.ts --replace path1.xlsx path2.xlsx
 */
import { config } from 'dotenv';
import { basename, join } from 'path';
import ExcelJS from 'exceljs';

config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withAppClient } from '@/lib/read-model/db';
import { saveMb51AgingImport } from '@/modules/mb51-aging/server/store';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

const DAY = 86400000;
const EPOCH_OFFSET = 25569;
const CHUNK = 8_000;

const DEFAULT_FILES = [
  'Mb51_01.xlsx',
  'MB51_02.xlsx',
  'MB51_03.xlsx',
  'MB51_04_30092026.xlsx',
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
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY + EPOCH_OFFSET);
  }
  return null;
}

const COLS: Record<string, string[]> = {
  date: ['postingdate'],
  mat: ['material'],
  desc: ['materialdescription'],
  grp: ['materialgroup'],
  qty: ['quantity', 'qtyinunitofentry', 'qty'],
  sup: ['supplier', 'vendor'],
  supn: ['suppliername', 'vendorname'],
  uom: ['baseunitofmeasure', 'unitofentry', 'uom'],
  mov: ['movementtype'],
  movt: ['movementtypetext'],
  text: ['text'],
  doc: ['materialdocument'],
  plant: ['plant'],
};

function rowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values;
  if (!Array.isArray(values)) return [];
  return values.slice(1);
}

async function importOneFile(opts: {
  filePath: string;
  importId: string | null;
  seqOffset: number;
  replaceFirst: boolean;
  finalize: boolean;
}): Promise<{ importId: string; seqOffset: number; parsed: number; skipped: number }> {
  const { filePath, replaceFirst, finalize } = opts;
  let { importId, seqOffset } = opts;
  const fileName = basename(filePath);
  console.log(`\n=== ${fileName} (append@${seqOffset}, finalize=${finalize}) ===`);

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
  let buf: Mb51AgingMovement[] = [];
  const startOffset = seqOffset;

  async function flush(isLast: boolean) {
    if (!buf.length) return;
    const chunk = buf;
    buf = [];
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const meta = await saveMb51AgingImport({
          fileName,
          uploadedBy: null,
          rows: chunk,
          replaceExisting: replaceFirst && importId == null,
          importId,
          seqOffset,
          // Freeze at this file's start so in-file dups across chunks are kept.
          dedupeBeforeSeq: startOffset,
          finalize: finalize && isLast,
        });
        importId = meta.id;
        seqOffset += chunk.length;
        console.log(
          `  saved chunk → db rows ${meta.rowCount.toLocaleString('en-IN')} (sent ${seqOffset - startOffset}/${parsed})`
        );
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  save retry ${attempt}/4: ${msg}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
    throw lastErr;
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
        const need = ['date', 'mat', 'qty'].filter((k) => colIx[k] < 0);
        if (need.length) {
          // title row — keep scanning
          if (cells.some((c) => String(c ?? '').trim())) continue;
          throw new Error(`${fileName}: missing columns ${need.join(', ')}`);
        }
        ix = colIx;
        console.log(`  headers ok qty=${ix.qty} date=${ix.date} mat=${ix.mat}`);
        continue;
      }

      const ds = toSerial(cells[ix.date]);
      if (ds == null) {
        const blank = cells.every((c) => c == null || String(c).trim() === '');
        if (!blank) skipped++;
        continue;
      }
      const qRaw = cells[ix.qty];
      const q = typeof qRaw === 'number' ? qRaw : Number(cellText(qRaw).replace(/,/g, ''));
      if (!Number.isFinite(q)) {
        skipped++;
        continue;
      }
      const mat = cellText(cells[ix.mat]);
      if (!mat) {
        skipped++;
        continue;
      }
      const cell = (key: string) => (ix![key] >= 0 ? cellText(cells[ix![key]]) : '');
      buf.push({
        d: ds,
        q,
        m: mat,
        md: cell('desc'),
        g: cell('grp'),
        u: cell('uom'),
        v: cell('sup'),
        vn: cell('supn'),
        mv: cell('plant'),
        s: startOffset + parsed,
        dc: cell('doc'),
        mt: cell('mov'),
        mtx: cell('movt'),
        tx: cell('text'),
      });
      parsed++;
      if (buf.length >= CHUNK) await flush(false);
    }
    break;
  }

  await flush(true);
  if (!parsed) throw new Error(`${fileName}: no usable rows`);
  if (!importId) throw new Error(`${fileName}: no import id`);

  console.log(
    `  done parsed=${parsed.toLocaleString('en-IN')} skipped=${skipped} seqOffset=${seqOffset}`
  );
  return { importId, seqOffset, parsed, skipped };
}

async function main() {
  const argv = process.argv.slice(2);
  const replace = argv.includes('--replace');
  const files = argv.filter((a) => a !== '--replace');
  const paths = (files.length ? files : DEFAULT_FILES).map((f) =>
    f.includes('/') || f.includes('\\') ? f : join(process.cwd(), f)
  );

  let importId: string | null = null;
  let seqOffset = 0;

  if (!replace) {
    const latest = await withAppClient(async (client) => {
      const res = await client.query<{ id: string; row_count: number; file_name: string }>(
        `SELECT id, row_count, file_name FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1`
      );
      return res.rows[0] ?? null;
    });
    if (latest) {
      importId = latest.id;
      seqOffset = latest.row_count;
      console.log(`Appending onto ${latest.file_name} (${latest.row_count} rows) id=${importId}`);
    } else {
      console.log('No existing import — creating new');
    }
  } else {
    console.log('Replace mode — first chunk wipes prior imports');
  }

  let totalParsed = 0;
  let totalSkipped = 0;
  for (let i = 0; i < paths.length; i++) {
    const isLast = i === paths.length - 1;
    const res = await importOneFile({
      filePath: paths[i],
      importId,
      seqOffset,
      replaceFirst: replace && i === 0,
      finalize: isLast,
    });
    importId = res.importId;
    seqOffset = res.seqOffset;
    totalParsed += res.parsed;
    totalSkipped += res.skipped;
  }

  const meta = await withAppClient(async (client) => {
    const res = await client.query<{
      id: string;
      file_name: string;
      row_count: number;
      plant_count: number;
      material_count: number;
    }>(
      `SELECT id, file_name, row_count, plant_count, material_count FROM mb51_aging_imports WHERE id = $1`,
      [importId]
    );
    if (importId) {
      await client.query(
        `UPDATE mb51_aging_imports SET file_name = $2 WHERE id = $1`,
        [importId, 'MB51 all']
      );
    }
    return res.rows[0];
  });

  console.log(
    JSON.stringify(
      {
        importId,
        totalParsed,
        totalSkipped,
        db: meta,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
