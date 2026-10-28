/**
 * Stream-import a large MB51 xlsx (SheetJS chokes on ~hundreds of MB sheets).
 * Includes SAP Text → item_text.
 *
 * Usage:
 *   npx tsx scripts/maintenance/import-mb51-xlsx-stream.ts path.xlsx
 *   npx tsx scripts/maintenance/import-mb51-xlsx-stream.ts path.xlsx --replace
 * Default: append to the latest import.
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
const CHUNK = 8000;

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
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
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
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

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--replace');
  const replace = process.argv.includes('--replace');
  const filePath = args[0];
  if (!filePath) throw new Error('Pass the xlsx path');
  const fileName = basename(filePath);

  await withAppClient(async (client) => {
    await client.query(
      `ALTER TABLE mb51_aging_rows ADD COLUMN IF NOT EXISTS item_text text NOT NULL DEFAULT ''`
    );
  });

  let importId: string | null = null;
  let seqOffset = 0;
  if (!replace) {
    const latest = await withAppClient(async (client) => {
      const res = await client.query<{ id: string; row_count: number; file_name: string }>(
        `SELECT id, row_count, file_name FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1`
      );
      return res.rows[0] ?? null;
    });
    if (!latest) {
      console.log('no existing import — creating new');
    } else {
      importId = latest.id;
      seqOffset = latest.row_count;
      console.log(`appending to ${latest.file_name} (${latest.row_count} rows) id=${importId}`);
    }
  } else {
    console.log('replace mode — clearing prior imports on first chunk');
  }

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
  let withText = 0;
  let buf: Mb51AgingMovement[] = [];
  const startOffset = seqOffset;

  async function flush(final: boolean) {
    if (!buf.length) {
      if (final && importId) {
        await withAppClient(async (client) => {
          await client.query(
            `
            UPDATE mb51_aging_imports
            SET row_count = $2,
                plant_count = (
                  SELECT count(DISTINCT NULLIF(plant, '')) FROM mb51_aging_rows WHERE import_id = $1
                ),
                material_count = (
                  SELECT count(DISTINCT NULLIF(material, '')) FROM mb51_aging_rows WHERE import_id = $1
                )
            WHERE id = $1
            `,
            [importId, startOffset + parsed]
          );
        });
      }
      return;
    }
    const chunk = buf;
    buf = [];
    const meta = await saveMb51AgingImport({
      fileName,
      uploadedBy: null,
      rows: chunk,
      replaceExisting: replace && importId == null,
      importId,
      seqOffset,
      expectedTotal: final ? startOffset + parsed : undefined,
    });
    importId = meta.id;
    seqOffset += chunk.length;
    console.log(`saved ${seqOffset - startOffset}/${parsed} new (db total ${seqOffset}) import ${importId}`);
  }

  for await (const worksheetReader of reader) {
    console.log(`sheet ${worksheetReader.name}`);
    for await (const row of worksheetReader) {
      const cells = rowValues(row);
      if (!ix) {
        const hdr = cells.map(norm);
        ix = {};
        for (const k of Object.keys(COLS)) {
          ix[k] = -1;
          for (const alias of COLS[k]) {
            const i = hdr.indexOf(alias);
            if (i >= 0) {
              ix[k] = i;
              break;
            }
          }
        }
        const need = ['date', 'mat', 'qty'].filter((k) => ix[k] < 0);
        if (need.length) throw new Error(`missing columns: ${need.join(', ')}`);
        console.log(
          `mapped text=${ix.text} movt=${ix.movt} qty=${ix.qty} uom=${ix.uom} date=${ix.date}`
        );
        continue;
      }

      const ds = toSerial(cells[ix.date]);
      if (ds == null) {
        skipped++;
        continue;
      }
      const qRaw = cells[ix.qty];
      const q = typeof qRaw === 'number' ? qRaw : Number(cellText(qRaw));
      if (!Number.isFinite(q)) {
        skipped++;
        continue;
      }
      const cell = (key: string) => (ix![key] >= 0 ? cellText(cells[ix![key]]) : '');
      const tx = cell('text');
      if (tx) withText++;
      buf.push({
        d: ds,
        q,
        m: cell('mat'),
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
        tx,
      });
      parsed++;
      if (buf.length >= CHUNK) await flush(false);
    }
    break; // first sheet only
  }

  await flush(true);
  if (!parsed) throw new Error('No usable rows');

  const check = await withAppClient(async (client) => {
    const res = await client.query<{ n: number; with_text: number }>(
      `
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE item_text <> '')::int AS with_text
      FROM mb51_aging_rows
      WHERE import_id = $1
      `,
      [importId]
    );
    await client.query(
      `UPDATE mb51_aging_imports SET file_name = $2, row_count = $3 WHERE id = $1`,
      [importId, replace ? fileName : `${fileName} (+prior)`, startOffset + parsed]
    );
    return res.rows[0];
  });

  console.log(
    JSON.stringify({
      parsed,
      skipped,
      withText,
      db: check,
      expected: startOffset + parsed,
    })
  );
  if (check?.n !== startOffset + parsed) {
    throw new Error(`row count ${check?.n} !== ${startOffset + parsed}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
