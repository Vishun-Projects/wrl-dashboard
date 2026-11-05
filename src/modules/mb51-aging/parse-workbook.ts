import * as XLSX from 'xlsx';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

const DAY = 86400000;
const EPOCH_OFFSET = 25569;

/** Decode &#x20; / &#32; / &amp; so SAP shared-string headers still normalize. */
function decodeHeaderEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export const normHeader = (s: unknown) =>
  decodeHeaderEntities(String(s == null ? '' : s))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * SAP MB51 export aliases (normalized). Prefer Quantity + Base Unit of Measure
 * when both Quantity and Qty in unit of entry exist.
 */
export const MB51_COLS: Record<string, string[]> = {
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
  amt: ['amtinloccur', 'amountinlocalcurrency', 'amtinlocalcurrency'],
};

const NEED_KEYS = ['date', 'mat', 'qty'] as const;
const NEED_LABEL: Record<(typeof NEED_KEYS)[number], string> = {
  date: 'Posting Date',
  mat: 'Material',
  qty: 'Quantity (or Qty in unit of entry)',
};

export function toPostingSerial(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial (~40k–60k) or mistaken epoch ms
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
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / DAY + EPOCH_OFFSET;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY + EPOCH_OFFSET;
  // 02-Nov-2026 / 02 Nov 2026
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY + EPOCH_OFFSET);
  }
  return null;
}

export function parseQty(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (!s) return null;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = `-${paren[1]}`;
  // Indian / EU thousands: 1,234.56 or 1.234,56 → keep last separator as decimal
  s = s.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type Mb51ParseResult = {
  rows: Mb51AgingMovement[];
  /** Human-readable reasons when nothing usable came out. */
  reasons: string[];
  qtyCol: string;
  uomCol: string;
  uomSeen: Map<string, number>;
  skippedBadDate: number;
  skippedBadQty: number;
  skippedBlankMat: number;
};

function mapHeaderIndexes(hdr: string[]): Record<string, number> {
  const ix: Record<string, number> = {};
  for (const k of Object.keys(MB51_COLS)) {
    ix[k] = -1;
    for (const nm of MB51_COLS[k]) {
      const i = hdr.indexOf(nm);
      if (i >= 0) {
        ix[k] = i;
        break;
      }
    }
  }
  return ix;
}

/** Find the header row in the first ~25 rows (SAP sometimes puts a title above). */
function findHeaderRow(data: unknown[][]): { rowIndex: number; hdrRaw: unknown[]; hdr: string[] } | null {
  const scan = Math.min(data.length, 25);
  for (let r = 0; r < scan; r++) {
    const hdrRaw = (data[r] as unknown[]) ?? [];
    const hdr = hdrRaw.map(normHeader);
    const ix = mapHeaderIndexes(hdr);
    if (NEED_KEYS.every((k) => ix[k] >= 0)) {
      return { rowIndex: r, hdrRaw, hdr };
    }
  }
  return null;
}

function missingNeedLabels(ix: Record<string, number>): string[] {
  return NEED_KEYS.filter((k) => ix[k] < 0).map((k) => NEED_LABEL[k]);
}

/** Sheets that SheetJS actually loaded (Workbook can list names for missing/chart sheets). */
export function listLoadedSheetNames(wb: XLSX.WorkBook): string[] {
  const fromBook = (wb.SheetNames ?? []).filter((n) => wb.Sheets?.[n] != null);
  if (fromBook.length) return fromBook;
  return Object.keys(wb.Sheets ?? {});
}

/**
 * Pick sheets to parse. Sheet *names* are irrelevant — any tab with MB51 columns works.
 * Ghost names in SheetNames that SheetJS didn't load are ignored (no error).
 * If the user picked specific tabs, only those that actually loaded are used;
 * if none of the picks loaded, fall back to every readable sheet.
 */
export function resolveMb51SheetNames(
  wb: XLSX.WorkBook,
  requested?: string[] | null
): { sheets: string[]; notes: string[] } {
  const available = listLoadedSheetNames(wb);
  if (!available.length) {
    return {
      sheets: [],
      notes: ['Workbook has no readable worksheets.'],
    };
  }

  const picks = (requested ?? []).map((n) => n.trim()).filter(Boolean);
  if (!picks.length) return { sheets: available, notes: [] };

  const byNorm = new Map(available.map((n) => [normHeader(n), n] as const));
  const resolved: string[] = [];
  for (const raw of picks) {
    if (wb.Sheets?.[raw] != null) {
      if (!resolved.includes(raw)) resolved.push(raw);
      continue;
    }
    const fuzzy = byNorm.get(normHeader(raw));
    if (fuzzy && !resolved.includes(fuzzy)) resolved.push(fuzzy);
  }

  // User picked tabs that aren't loadable → just use whatever SheetJS gave us.
  if (!resolved.length) return { sheets: available, notes: [] };
  return { sheets: resolved, notes: [] };
}

export function parseMb51Workbook(
  wb: XLSX.WorkBook,
  sheetNames?: string[] | null
): Mb51ParseResult {
  const out: Mb51AgingMovement[] = [];
  const reasons: string[] = [];
  let qtyCol = '';
  let uomCol = '';
  const uomSeen = new Map<string, number>();
  let skippedBadDate = 0;
  let skippedBadQty = 0;
  let skippedBlankMat = 0;

  const { sheets: resolvedNames, notes } = resolveMb51SheetNames(wb, sheetNames);
  reasons.push(...notes);

  if (!resolvedNames.length) {
    return {
      rows: [],
      reasons: reasons.length
        ? reasons
        : ['Workbook has no readable worksheets.'],
      qtyCol,
      uomCol,
      uomSeen,
      skippedBadDate,
      skippedBadQty,
      skippedBlankMat,
    };
  }

  for (const sn of resolvedNames) {
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const data: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: '',
    });
    if (!data.length) {
      reasons.push(`Sheet "${sn}": empty.`);
      continue;
    }

    const found = findHeaderRow(data);
    if (!found) {
      const first = ((data[0] as unknown[]) ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
      const preview = first.slice(0, 8).join(' | ') || '(no cells)';
      const ix0 = mapHeaderIndexes(((data[0] as unknown[]) ?? []).map(normHeader));
      const missing = missingNeedLabels(ix0);
      reasons.push(
        `Sheet "${sn}": required columns not found (${missing.join(', ')}). ` +
          `First-row headers look like: ${preview}. ` +
          `Need at least: Posting Date, Material, Quantity (or Qty in unit of entry).`
      );
      continue;
    }

    const { rowIndex, hdrRaw, hdr } = found;
    const ix = mapHeaderIndexes(hdr);
    if (!qtyCol && ix.qty >= 0) qtyCol = String(hdrRaw[ix.qty] ?? '');
    if (!uomCol && ix.uom >= 0) uomCol = String(hdrRaw[ix.uom] ?? '');
    if (rowIndex > 0) {
      reasons.push(`Sheet "${sn}": header detected on row ${rowIndex + 1} (skipped title rows above).`);
    }

    let sheetRows = 0;
    for (let r = rowIndex + 1; r < data.length; r++) {
      const row = data[r] as unknown[];
      const mat = String(row[ix.mat] ?? '').trim();
      const ds = toPostingSerial(row[ix.date]);
      if (ds == null) {
        // Skip fully blank trailing rows quietly
        const blank = row.every((c) => c == null || String(c).trim() === '');
        if (!blank) skippedBadDate++;
        continue;
      }
      const q = parseQty(row[ix.qty]);
      if (q == null) {
        skippedBadQty++;
        continue;
      }
      if (!mat) {
        skippedBlankMat++;
        continue;
      }
      const uo = ix.uom >= 0 ? String(row[ix.uom] ?? '').trim() : '';
      uomSeen.set(uo, (uomSeen.get(uo) || 0) + 1);
      out.push({
        d: ds,
        q,
        m: mat,
        md: ix.desc >= 0 ? String(row[ix.desc] ?? '').trim() : '',
        g: ix.grp >= 0 ? String(row[ix.grp] ?? '').trim() : '',
        u: uo,
        v: ix.sup >= 0 ? String(row[ix.sup] ?? '').trim() : '',
        vn: ix.supn >= 0 ? String(row[ix.supn] ?? '').trim() : '',
        mv: ix.plant >= 0 ? String(row[ix.plant] ?? '').trim() : '',
        s: out.length,
        dc: ix.doc >= 0 ? String(row[ix.doc] ?? '').trim() : '',
        mt: ix.mov >= 0 ? String(row[ix.mov] ?? '').trim() : '',
        mtx: ix.movt >= 0 ? String(row[ix.movt] ?? '').trim() : '',
        tx: ix.text >= 0 ? String(row[ix.text] ?? '').trim() : '',
        amt: ix.amt >= 0 ? parseQty(row[ix.amt]) : null,
      });
      sheetRows++;
    }
    if (!sheetRows) {
      reasons.push(
        `Sheet "${sn}": headers OK but no data rows parsed` +
          (skippedBadDate || skippedBadQty || skippedBlankMat
            ? ` (bad Posting Date: ${skippedBadDate}, bad Quantity: ${skippedBadQty}, blank Material: ${skippedBlankMat}).`
            : '.')
      );
    }
  }

  return {
    rows: out,
    reasons,
    qtyCol,
    uomCol,
    uomSeen,
    skippedBadDate,
    skippedBadQty,
    skippedBlankMat,
  };
}

/** Build the message shown when parse yields zero rows. */
export function formatMb51ParseFailure(parsed: Mb51ParseResult): string {
  if (parsed.reasons.length) return parsed.reasons.join(' ');
  if (parsed.skippedBadDate || parsed.skippedBadQty || parsed.skippedBlankMat) {
    return (
      `No usable rows. Skipped — bad Posting Date: ${parsed.skippedBadDate}, ` +
      `bad Quantity: ${parsed.skippedBadQty}, blank Material: ${parsed.skippedBlankMat}.`
    );
  }
  return 'No usable rows found. Need Posting Date, Material, and Quantity (or Qty in unit of entry). Download a template below if unsure.';
}

/** SAP-style headers (Quantity + Base Unit of Measure). */
export const MB51_TEMPLATE_SAP_HEADERS = [
  'Plant',
  'Material Document',
  'Document Date',
  'Posting Date',
  'Material',
  'Material Description',
  'Storage Location',
  'Base Unit of Measure',
  'Quantity',
  'Amt.in Loc.Cur.',
  'Movement Type',
  'Movement Type Text',
  'Batch',
  'Entry Date',
  'User Name',
  'Material Group',
  'Customer',
  'Document Header Text',
  'Text',
  'Material Doc. Year',
  'Order',
  'Supplier',
  'Supplier Name',
] as const;

/** Alternate headers (Qty in unit of entry + Unit of Entry). */
export const MB51_TEMPLATE_QTY_ENTRY_HEADERS = [
  'Plant',
  'Material Document',
  'Posting Date',
  'Material',
  'Material Description',
  'Material Group',
  'Qty in unit of entry',
  'Unit of Entry',
  'Supplier',
  'Supplier Name',
  'Movement Type',
  'Movement Type Text',
  'Text',
] as const;

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function sampleRowSap(): string[] {
  return [
    '1140',
    '4900123456',
    '01.04.2025',
    '01.04.2025',
    'MAT-001',
    'Sample compressor part',
    '0001',
    'EA',
    '2',
    '1000',
    '101',
    'GR goods receipt',
    '',
    '01.04.2025',
    'USER1',
    'COMP',
    '',
    '',
    'Sample text',
    '2025',
    '',
    'VEND-99',
    'Apex Spares',
  ];
}

function sampleRowQtyEntry(): string[] {
  return [
    '1140',
    '4900123456',
    '01.04.2025',
    'MAT-001',
    'Sample compressor part',
    'COMP',
    '2',
    'EA',
    'VEND-99',
    'Apex Spares',
    '101',
    'GR goods receipt',
    'Sample text',
  ];
}

export function buildMb51TemplateCsv(
  kind: 'sap' | 'qty-entry'
): { fileName: string; csv: string } {
  if (kind === 'sap') {
    const headers = [...MB51_TEMPLATE_SAP_HEADERS];
    return {
      fileName: 'MB51_template_SAP_Quantity.csv',
      csv: `${headers.map(csvEscape).join(',')}\n${sampleRowSap().map(csvEscape).join(',')}\n`,
    };
  }
  const headers = [...MB51_TEMPLATE_QTY_ENTRY_HEADERS];
  return {
    fileName: 'MB51_template_Qty_in_unit_of_entry.csv',
    csv: `${headers.map(csvEscape).join(',')}\n${sampleRowQtyEntry().map(csvEscape).join(',')}\n`,
  };
}

export function downloadMb51TemplateCsv(kind: 'sap' | 'qty-entry'): void {
  const { fileName, csv } = buildMb51TemplateCsv(kind);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
