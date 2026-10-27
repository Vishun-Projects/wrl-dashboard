/**
 * One-shot: add mb51_aging_rows.item_text and replace the latest MB51 import
 * from an SAP export, including the Text column.
 *
 * Usage: npx tsx scripts/maintenance/reimport-mb51-ka29.ts "C:/path/MB51-KA29.XLSX"
 */
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withAppClient } from '@/lib/read-model/db';
import { saveMb51AgingImport } from '@/modules/mb51-aging/server/store';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';
import * as XLSX from 'xlsx';

const DAY = 86400000;
const EPOCH_OFFSET = 25569;
const CHUNK = 8000;

const norm = (s: unknown) =>
  String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function toSerial(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / DAY + EPOCH_OFFSET);
  }
  const s = String(v).trim();
  let match = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / DAY + EPOCH_OFFSET;
  match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY + EPOCH_OFFSET;
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

function parseFile(filePath: string): Mb51AgingMovement[] {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const out: Mb51AgingMovement[] = [];
  let skipped = 0;

  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
    if (!data.length) continue;
    const hdr = (data[0] as unknown[]).map(norm);
    const ix: Record<string, number> = {};
    for (const k of Object.keys(COLS)) {
      ix[k] = -1;
      for (const nm of COLS[k]) {
        const i = hdr.indexOf(nm);
        if (i >= 0) {
          ix[k] = i;
          break;
        }
      }
    }
    if (ix.text < 0) throw new Error(`${sn}: Text column not found`);
    const need = ['date', 'mat', 'qty'].filter((k) => ix[k] < 0);
    if (need.length) throw new Error(`${sn}: missing ${need.join(', ')}`);

    for (let r = 1; r < data.length; r++) {
      const row = data[r] as unknown[];
      const ds = toSerial(row[ix.date]);
      if (ds == null) {
        skipped++;
        continue;
      }
      const q = Number(row[ix.qty]);
      if (!Number.isFinite(q)) {
        skipped++;
        continue;
      }
      const cell = (key: string) => (ix[key] >= 0 ? String(row[ix[key]] ?? '').trim() : '');
      out.push({
        d: ds,
        q,
        m: cell('mat'),
        md: cell('desc'),
        g: cell('grp'),
        u: cell('uom'),
        v: cell('sup'),
        vn: cell('supn'),
        mv: cell('plant'),
        s: out.length,
        dc: cell('doc'),
        mt: cell('mov'),
        mtx: cell('movt'),
        tx: cell('text'),
      });
    }
  }

  console.log(`parsed ${out.length} rows, skipped ${skipped}, with text ${out.filter((r) => r.tx).length}`);
  return out;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error('Pass the xlsx path');
  const fileName = filePath.split(/[/\\]/).pop() || 'MB51_Export.xlsx';
  const rows = parseFile(filePath);
  if (!rows.length) throw new Error('No usable rows');

  await withAppClient(async (client) => {
    await client.query(
      `ALTER TABLE mb51_aging_rows ADD COLUMN IF NOT EXISTS item_text text NOT NULL DEFAULT ''`
    );
  });

  let importId: string | null = null;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const meta = await saveMb51AgingImport({
      fileName,
      uploadedBy: null,
      rows: chunk,
      replaceExisting: offset === 0,
      importId,
      seqOffset: offset,
      expectedTotal: rows.length,
    });
    importId = meta.id;
    console.log(`saved ${offset + chunk.length}/${rows.length} import ${importId}`);
  }

  const check = await withAppClient(async (client) => {
    const res = await client.query<{
      n: number;
      with_text: number;
      sample: string | null;
    }>(
      `
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE item_text <> '')::int AS with_text,
             max(item_text) FILTER (WHERE material_document = '4907271174') AS sample
      FROM mb51_aging_rows
      WHERE import_id = $1
      `,
      [importId]
    );
    return res.rows[0];
  });
  console.log(JSON.stringify(check));
  if (check?.n !== rows.length) throw new Error(`row count ${check?.n} !== ${rows.length}`);
  if (!check?.with_text) throw new Error('item_text is empty');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
