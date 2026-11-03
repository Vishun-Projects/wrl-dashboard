/**
 * SheetJS silently drops huge worksheets (e.g. ~1M-row SAP MB51 xlsx: sheet XML
 * ~700MB uncompressed). Stream the zip entry with JSZip and parse rows ourselves.
 */
import JSZip from 'jszip';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';
import {
  MB51_COLS,
  normHeader,
  parseQty,
  toPostingSerial,
  type Mb51ParseResult,
} from '@/modules/mb51-aging/parse-workbook';

const NEED_KEYS = ['date', 'mat', 'qty'] as const;
const NEED_LABEL: Record<(typeof NEED_KEYS)[number], string> = {
  date: 'Posting Date',
  mat: 'Material',
  qty: 'Quantity (or Qty in unit of entry)',
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

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) & 31);
  }
  return n - 1;
}

/** SAP exports often encode spaces as &#x20; in shared strings. */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Shared strings table — SAP MB51 uses plain <si><t>…</t></si>. */
export function parseSharedStringsXml(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const body = m[1];
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(body))) parts.push(decodeXmlEntities(tm[1]));
    out.push(parts.join(''));
  }
  return out;
}

function cellValue(
  attrs: string,
  vRaw: string | undefined,
  inline: string | undefined,
  strings: string[]
): unknown {
  if (inline != null) return decodeXmlEntities(inline);
  const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
  if (vRaw == null || vRaw === '') return '';
  if (t === 's') {
    const i = Number(vRaw);
    return Number.isFinite(i) ? (strings[i] ?? '') : '';
  }
  if (t === 'b') return vRaw === '1' || vRaw === 'true';
  if (t === 'str' || t === 'inlineStr') return decodeXmlEntities(vRaw);
  const n = Number(vRaw);
  return Number.isFinite(n) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(vRaw) ? n : decodeXmlEntities(vRaw);
}

/** Parse one <row>…</row> into a sparse-filled cell array. */
export function parseSheetRowXml(rowXml: string, strings: string[]): unknown[] {
  const cells: unknown[] = [];
  const cellRe =
    /<c\b([^>]*?)(?:\/>|>(?:<v>([^<]*)<\/v>|<is>\s*<t\b[^>]*>([\s\S]*?)<\/t>\s*<\/is>)?[\s\S]*?<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml))) {
    const attrs = m[1];
    const ref = /\br="([A-Z]+)(\d+)"/i.exec(attrs);
    if (!ref) continue;
    const idx = colLettersToIndex(ref[1].toUpperCase());
    while (cells.length <= idx) cells.push('');
    cells[idx] = cellValue(attrs, m[2], m[3], strings);
  }
  return cells;
}

type RowParser = {
  feed: (row: unknown[]) => void;
  result: () => Mb51ParseResult;
};

function createRowParser(sheetLabel: string): RowParser {
  const out: Mb51AgingMovement[] = [];
  const reasons: string[] = [];
  const uomSeen = new Map<string, number>();
  let qtyCol = '';
  let uomCol = '';
  let skippedBadDate = 0;
  let skippedBadQty = 0;
  let skippedBlankMat = 0;
  let ix: Record<string, number> | null = null;
  let hdrRaw: unknown[] = [];
  const pending: unknown[][] = [];
  let rowsSeen = 0;
  let sheetRows = 0;

  function startFromHeader(rowIndex: number, rows: unknown[][]) {
    hdrRaw = rows[rowIndex] ?? [];
    const hdr = hdrRaw.map(normHeader);
    ix = mapHeaderIndexes(hdr);
    if (ix.qty >= 0) qtyCol = String(hdrRaw[ix.qty] ?? '');
    if (ix.uom >= 0) uomCol = String(hdrRaw[ix.uom] ?? '');
    if (rowIndex > 0) {
      reasons.push(
        `Sheet "${sheetLabel}": header detected on row ${rowIndex + 1} (skipped title rows above).`
      );
    }
    for (let r = rowIndex + 1; r < rows.length; r++) consumeData(rows[r] ?? []);
  }

  function consumeData(row: unknown[]) {
    if (!ix) return;
    const mat = String(row[ix.mat] ?? '').trim();
    const ds = toPostingSerial(row[ix.date]);
    if (ds == null) {
      const blank = row.every((c) => c == null || String(c).trim() === '');
      if (!blank) skippedBadDate++;
      return;
    }
    const q = parseQty(row[ix.qty]);
    if (q == null) {
      skippedBadQty++;
      return;
    }
    if (!mat) {
      skippedBlankMat++;
      return;
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
    });
    sheetRows++;
  }

  return {
    feed(row: unknown[]) {
      rowsSeen++;
      if (!ix) {
        pending.push(row);
        if (pending.length <= 25) {
          for (let r = 0; r < pending.length; r++) {
            const hdr = (pending[r] ?? []).map(normHeader);
            const tryIx = mapHeaderIndexes(hdr);
            if (NEED_KEYS.every((k) => tryIx[k] >= 0)) {
              startFromHeader(r, pending);
              pending.length = 0;
              return;
            }
          }
        }
        if (pending.length === 25) {
          const first = (pending[0] ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
          const preview = first.slice(0, 8).join(' | ') || '(no cells)';
          const missing = NEED_KEYS.filter((k) => mapHeaderIndexes((pending[0] ?? []).map(normHeader))[k] < 0).map(
            (k) => NEED_LABEL[k]
          );
          reasons.push(
            `Sheet "${sheetLabel}": required columns not found (${missing.join(', ')}). ` +
              `First-row headers look like: ${preview}. ` +
              `Need at least: Posting Date, Material, Quantity (or Qty in unit of entry).`
          );
          ix = mapHeaderIndexes([]); // mark failed so we stop scanning
        }
        return;
      }
      if (!NEED_KEYS.every((k) => (ix as Record<string, number>)[k] >= 0)) return;
      consumeData(row);
    },
    result(): Mb51ParseResult {
      if (!ix) {
        if (!reasons.length) {
          reasons.push(
            rowsSeen
              ? `Sheet "${sheetLabel}": required columns not found. Need Posting Date, Material, Quantity.`
              : `Sheet "${sheetLabel}": empty.`
          );
        }
      } else if (!sheetRows) {
        reasons.push(
          `Sheet "${sheetLabel}": headers OK but no data rows parsed` +
            (skippedBadDate || skippedBadQty || skippedBlankMat
              ? ` (bad Posting Date: ${skippedBadDate}, bad Quantity: ${skippedBadQty}, blank Material: ${skippedBlankMat}).`
              : '.')
        );
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
    },
  };
}

function worksheetPaths(zip: JSZip): string[] {
  const paths: string[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(relativePath)) paths.push(relativePath);
  });
  paths.sort((a, b) => {
    const na = Number(/sheet(\d+)/i.exec(a)?.[1] ?? 0);
    const nb = Number(/sheet(\d+)/i.exec(b)?.[1] ?? 0);
    return na - nb;
  });
  return paths;
}

type ZipNodeStreamFile = JSZip.JSZipObject & {
  nodeStream?: (type: string) => NodeJS.ReadableStream;
};

/**
 * JSZip.internalStream is a no-op in Node (never emits). Prefer nodeStream;
 * in the browser fall back to loading the entry (ponytail: ~700MB sheet may OOM
 * — upgrade: true streaming inflate via DecompressionStream).
 */
async function* iterateZipFileText(file: JSZip.JSZipObject): AsyncGenerator<string> {
  const withNode = file as ZipNodeStreamFile;
  if (typeof withNode.nodeStream === 'function') {
    const stream = withNode.nodeStream('nodebuffer');
    const queue: string[] = [];
    let done = false;
    let err: Error | null = null;
    let wake: (() => void) | null = null;
    const kick = () => {
      wake?.();
      wake = null;
    };
    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      queue.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      kick();
    });
    stream.on('error', (e: Error) => {
      err = e;
      done = true;
      kick();
    });
    stream.on('end', () => {
      done = true;
      kick();
    });
    for (;;) {
      if (queue.length) {
        yield queue.shift() as string;
        continue;
      }
      if (err) throw err;
      if (done) return;
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  }
  yield await file.async('string');
}

async function feedSheetXml(
  file: JSZip.JSZipObject,
  strings: string[],
  parser: RowParser,
  onProgress?: (rowsSeen: number) => void
): Promise<void> {
  let buf = '';
  let rowsSeen = 0;
  const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
  for await (const chunk of iterateZipFileText(file)) {
    buf += chunk;
    rowRe.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(buf))) {
      parser.feed(parseSheetRowXml(m[0], strings));
      rowsSeen++;
      last = rowRe.lastIndex;
      if (onProgress && rowsSeen % 50_000 === 0) onProgress(rowsSeen);
    }
    if (last > 0) buf = buf.slice(last);
    // ponytail: keep a safety cap so a missing </row> cannot unbounded-grow RAM
    if (buf.length > 8_000_000) {
      throw new Error('Worksheet XML row buffer exceeded 8MB — file may be corrupt.');
    }
  }
  rowRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(buf))) {
    parser.feed(parseSheetRowXml(m[0], strings));
    rowsSeen++;
  }
  if (onProgress) onProgress(rowsSeen);
}

export type ParseMb51XlsxZipOpts = {
  onProgress?: (msg: string) => void;
};

/** ~10MB compressed — SheetJS often lists the tab then leaves Sheets empty. */
export const MB51_XLSX_ZIP_FALLBACK_BYTES = 10 * 1024 * 1024;

export type ParseMb51UploadOpts = ParseMb51XlsxZipOpts & {
  fileName?: string;
  fileSize?: number;
};

/**
 * Prefer SheetJS for normal files; stream-zip for huge / ghost-sheet xlsx.
 */
export async function parseMb51Upload(
  data: ArrayBuffer,
  opts?: ParseMb51UploadOpts
): Promise<Mb51ParseResult> {
  const name = (opts?.fileName ?? '').toLowerCase();
  const size = opts?.fileSize ?? data.byteLength;
  const isOoxml =
    name.endsWith('.xlsx') ||
    name.endsWith('.xlsm') ||
    // unnamed buffer: sniff zip magic PK
    (!name && data.byteLength >= 4 && new Uint8Array(data, 0, 2)[0] === 0x50 && new Uint8Array(data, 0, 2)[1] === 0x4b);

  // Huge OOXML: skip SheetJS (it lists the tab then leaves Sheets empty).
  if (isOoxml && size >= MB51_XLSX_ZIP_FALLBACK_BYTES) {
    return parseMb51XlsxZip(data, opts);
  }

  const XLSX = await import('xlsx');
  const { listLoadedSheetNames, parseMb51Workbook } = await import(
    '@/modules/mb51-aging/parse-workbook'
  );
  opts?.onProgress?.('Reading workbook…');
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true, raw: true });
  const loaded = listLoadedSheetNames(wb);
  if (loaded.length) return parseMb51Workbook(wb);

  // Ghost SheetNames / empty Sheets — stream the xlsx zip
  if (isOoxml || (wb.SheetNames?.length && !loaded.length)) {
    opts?.onProgress?.('SheetJS could not load sheets; streaming xlsx zip…');
    return parseMb51XlsxZip(data, opts);
  }
  return parseMb51Workbook(wb);
}

/**
 * Parse an .xlsx ArrayBuffer without SheetJS worksheet load.
 * Handles SAP MB51 dumps SheetJS leaves as ghost tabs.
 */
export async function parseMb51XlsxZip(
  data: ArrayBuffer | Uint8Array,
  opts?: ParseMb51XlsxZipOpts
): Promise<Mb51ParseResult> {
  const onProgress = opts?.onProgress;
  onProgress?.('Reading workbook zip…');
  const zip = await JSZip.loadAsync(data);
  const ssFile = zip.file('xl/sharedStrings.xml');
  let strings: string[] = [];
  if (ssFile) {
    onProgress?.('Loading shared strings…');
    strings = parseSharedStringsXml(await ssFile.async('string'));
  }

  const sheets = worksheetPaths(zip);
  if (!sheets.length) {
    return {
      rows: [],
      reasons: ['Workbook has no worksheets inside the xlsx zip.'],
      qtyCol: '',
      uomCol: '',
      uomSeen: new Map(),
      skippedBadDate: 0,
      skippedBadQty: 0,
      skippedBlankMat: 0,
    };
  }

  const merged: Mb51ParseResult = {
    rows: [],
    reasons: [],
    qtyCol: '',
    uomCol: '',
    uomSeen: new Map(),
    skippedBadDate: 0,
    skippedBadQty: 0,
    skippedBlankMat: 0,
  };

  for (const path of sheets) {
    const file = zip.file(path);
    if (!file) continue;
    const label = path.replace(/^xl\/worksheets\//i, '');
    onProgress?.(`Streaming ${label}…`);
    const parser = createRowParser(label);
    await feedSheetXml(file, strings, parser, (n) => onProgress?.(`Streaming ${label}: ${n.toLocaleString('en-IN')} rows…`));
    const part = parser.result();
    if (!merged.qtyCol && part.qtyCol) merged.qtyCol = part.qtyCol;
    if (!merged.uomCol && part.uomCol) merged.uomCol = part.uomCol;
    merged.skippedBadDate += part.skippedBadDate;
    merged.skippedBadQty += part.skippedBadQty;
    merged.skippedBlankMat += part.skippedBlankMat;
    merged.reasons.push(...part.reasons);
    for (const [k, v] of part.uomSeen) merged.uomSeen.set(k, (merged.uomSeen.get(k) || 0) + v);
    const base = merged.rows.length;
    for (let i = 0; i < part.rows.length; i++) {
      const r = part.rows[i];
      r.s = base + i;
      merged.rows.push(r);
    }
  }

  return merged;
}
