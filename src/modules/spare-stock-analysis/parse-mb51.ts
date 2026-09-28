import { parseCalendarString } from '@/lib/dates/ui-date';
import { isSpareStockPlantExcluded } from '@/modules/spare-stock-analysis/plants';
import { parseSapAmount, parseSapQty, txnTypeForMvt } from '@/modules/spare-stock-analysis/sap-numbers';
import type { SpareStockParsedRow } from '@/modules/spare-stock-analysis/types';

/** SAP ALV HTML uses hex entities (`&#x28;` = `(`). Decimal + a few named ones too. */
export function decodeMb51Entities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const v = Number(n);
      return Number.isFinite(v) ? String.fromCodePoint(v) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function cellText(raw: string): string {
  return decodeMb51Entities(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normHeader(raw: string): string {
  return cellText(raw).toLowerCase().replace(/\s+/g, ' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function sapDateToIso(raw: string): string | null {
  const cal = parseCalendarString(raw);
  if (!cal) return null;
  const y = Number(cal.year);
  const m = Number(cal.month);
  const d = Number(cal.day);
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export type ColMap = {
  plant: number;
  matDoc: number;
  docDate: number;
  postingDate: number;
  material: number;
  materialDescription: number;
  location: number;
  uom: number;
  qty: number;
  lcAmount: number;
  mvt: number;
  mvtText: number;
  batch: number;
  entryDate: number;
  entryTime: number;
  sapUser: number;
  materialGroup: number;
  customer: number;
  headerText: number;
  callNo: number;
  matYr: number;
  orderNo: number;
  supplier: number;
};

export function mapHeaders(cells: string[]): ColMap | null {
  const idx = (pred: (h: string) => boolean): number => cells.findIndex(pred);
  const plant = idx((h) => h === 'plnt' || h === 'plant');
  const mvt = idx((h) => h === 'mvt' || h === 'mv t');
  const qty = idx(
    (h) =>
      h === 'qty in une' ||
      h === 'qty in un e' ||
      h.startsWith('qty in') ||
      h.startsWith('quantity in')
  );
  const postingDate = idx((h) => h === 'pstng date' || h === 'posting date');
  const material = idx((h) => h === 'material');
  if (plant < 0 || mvt < 0 || qty < 0 || material < 0) return null;
  if (postingDate < 0 && idx((h) => h === 'doc. date' || h === 'doc date') < 0) return null;

  return {
    plant,
    matDoc: idx((h) => h.startsWith('mat. doc') || h === 'mat doc' || h.startsWith('material doc')),
    docDate: idx((h) => h === 'doc. date' || h === 'doc date'),
    postingDate,
    material,
    materialDescription: idx((h) => h.startsWith('material description')),
    location: idx((h) => h === 'location'),
    uom: idx((h) => h === 'eun' || h === 'un'),
    qty,
    lcAmount: idx((h) => h === 'lc amount'),
    mvt,
    mvtText: idx((h) => h.startsWith('movement type')),
    batch: idx((h) => h === 'batch'),
    entryDate: idx((h) => h === 'entry date'),
    entryTime: idx((h) => h === 'time'),
    sapUser: idx((h) => h === 'user' || h === 'user name' || h.startsWith('user')),
    materialGroup: idx((h) => h.startsWith('material group')),
    customer: idx((h) => h === 'customer'),
    headerText: idx((h) => h.startsWith('document header')),
    callNo: idx((h) => h === 'text'),
    matYr: idx((h) => h === 'matyr' || h === 'mat yr'),
    orderNo: idx((h) => h === 'order'),
    supplier: idx((h) => h === 'supplier'),
  };
}

function pick(cells: string[], i: number): string {
  if (i < 0 || i >= cells.length) return '';
  return cells[i] ?? '';
}

function isDataPlant(plant: string): boolean {
  return /^\d+$/.test(plant.replace(/\s+/g, ''));
}

export async function movementRowKey(parts: {
  plant: string;
  matDoc: string;
  matYr: string;
  material: string;
  mvt: string;
  postingDate: string;
  qty: number;
  location: string;
  supplier: string;
  callNo: string;
  entryDate: string;
  entryTime: string;
  batch: string;
}): Promise<string> {
  const payload = [
    parts.plant,
    parts.matDoc,
    parts.matYr,
    parts.material,
    parts.mvt,
    parts.postingDate,
    String(parts.qty),
    parts.location,
    parts.supplier,
    parts.callNo,
    parts.entryDate,
    parts.entryTime,
    parts.batch,
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function cellsToRow(
  cells: string[],
  colMap: ColMap
): Promise<SpareStockParsedRow | 'skip'> {
  const plant = pick(cells, colMap.plant).replace(/\s+/g, '');
  if (!isDataPlant(plant) || isSpareStockPlantExcluded(plant)) return 'skip';

  const postingRaw = pick(cells, colMap.postingDate) || pick(cells, colMap.docDate);
  const postingDate = sapDateToIso(postingRaw);
  if (!postingDate) return 'skip';

  const mvt = pick(cells, colMap.mvt).replace(/\s+/g, '');
  const material = pick(cells, colMap.material).replace(/\s+/g, '');
  const qty = parseSapQty(pick(cells, colMap.qty));
  const matDoc = pick(cells, colMap.matDoc).replace(/\s+/g, '');
  const matYr = pick(cells, colMap.matYr).replace(/\s+/g, '');
  const location = pick(cells, colMap.location);
  const supplier = pick(cells, colMap.supplier);
  const callNo = pick(cells, colMap.callNo);
  const entryDateIso = sapDateToIso(pick(cells, colMap.entryDate));
  const entryTime = pick(cells, colMap.entryTime);
  const batch = pick(cells, colMap.batch);

  return {
    plant,
    matDoc,
    docDate: sapDateToIso(pick(cells, colMap.docDate)),
    postingDate,
    material,
    materialDescription: pick(cells, colMap.materialDescription),
    location,
    uom: pick(cells, colMap.uom),
    qty,
    lcAmount: parseSapAmount(pick(cells, colMap.lcAmount)),
    mvt,
    mvtText: pick(cells, colMap.mvtText),
    txnType: txnTypeForMvt(mvt),
    batch,
    entryDate: entryDateIso,
    entryTime,
    sapUser: pick(cells, colMap.sapUser),
    materialGroup: pick(cells, colMap.materialGroup),
    customer: pick(cells, colMap.customer),
    headerText: pick(cells, colMap.headerText),
    callNo,
    matYr,
    orderNo: pick(cells, colMap.orderNo),
    supplier,
    rowKey: await movementRowKey({
      plant,
      matDoc,
      matYr,
      material,
      mvt,
      postingDate,
      qty,
      location,
      supplier,
      callNo,
      entryDate: entryDateIso ?? '',
      entryTime,
      batch,
    }),
  };
}

function stripCellHtml(inner: string): string {
  return cellText(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''));
}

export function cellsFromTrHtml(trHtml: string): string[] {
  const cells: string[] = [];
  const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trHtml))) {
    cells.push(stripCellHtml(m[1] ?? ''));
  }
  return cells;
}

export type ParseMb51Progress = {
  bytesRead: number;
  fileBytes: number;
  rows: number;
  skipped: number;
};

export const MB51_ROW_BATCH = 800;

function decoderFor(first: Uint8Array): TextDecoder {
  if (first.length >= 2 && first[0] === 0xff && first[1] === 0xfe) {
    return new TextDecoder('utf-16le');
  }
  if (first.length >= 2 && first[0] === 0xfe && first[1] === 0xff) {
    return new TextDecoder('utf-16be');
  }
  return new TextDecoder('utf-8');
}

/**
 * Stream-parse SAP MB51 HTML without loading the whole file.
 * 1GB ALV dumps stay in a small pending buffer plus the flushed row batch.
 */
export async function parseMb51FileInBatches(
  file: Blob,
  onBatch: (rows: SpareStockParsedRow[], skippedDelta: number, progress: ParseMb51Progress) => Promise<void>,
  onProgress?: (p: ParseMb51Progress) => void
): Promise<{ parsed: number; skipped: number }> {
  const batch: SpareStockParsedRow[] = [];
  let parsed = 0;
  let skipped = 0;
  let skippedSinceFlush = 0;
  let colMap: ColMap | null = null;
  let pending = '';
  let bytesRead = 0;
  let decoder: TextDecoder | null = null;
  const reader = file.stream().getReader();

  const progress = (): ParseMb51Progress => ({
    bytesRead,
    fileBytes: file.size,
    rows: parsed,
    skipped,
  });

  const flush = async () => {
    if (batch.length === 0 && skippedSinceFlush === 0) return;
    const take = batch.splice(0, batch.length);
    const skipTake = skippedSinceFlush;
    skippedSinceFlush = 0;
    await onBatch(take, skipTake, progress());
  };

  const handleTr = async (trHtml: string) => {
    const cells = cellsFromTrHtml(trHtml);
    if (cells.length < 6) return;
    if (!colMap) {
      colMap = mapHeaders(cells.map(normHeader));
      return;
    }
    const row = await cellsToRow(cells, colMap);
    if (row === 'skip') {
      skipped += 1;
      skippedSinceFlush += 1;
      return;
    }
    parsed += 1;
    batch.push(row);
    if (batch.length >= MB51_ROW_BATCH) await flush();
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      bytesRead += value.byteLength;
      if (!decoder) decoder = decoderFor(value);
      pending += decoder.decode(value, { stream: !done });
    }
    if (done) pending += (decoder ?? new TextDecoder()).decode();

    while (true) {
      const start = pending.search(/<tr[\s>]/i);
      if (start < 0) {
        if (pending.length > 2_000_000) pending = pending.slice(-256_000);
        break;
      }
      const rest = pending.slice(start);
      const endRel = rest.search(/<\/tr>/i);
      if (endRel < 0) {
        pending = pending.slice(start);
        if (pending.length > 8_000_000) {
          throw new Error('MB51 HTML row is too large to parse. Export a smaller date range from SAP.');
        }
        break;
      }
      const tr = rest.slice(0, endRel + 5);
      pending = rest.slice(endRel + 5);
      await handleTr(tr);
    }

    onProgress?.(progress());
    if (done) break;
  }

  await flush();

  if (!colMap) {
    throw new Error(
      'Could not find header row (expected Plnt/Plant, Material, MvT, Qty or Quantity in UnE, Pstng Date)'
    );
  }

  return { parsed, skipped };
}
