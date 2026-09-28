import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { parseCalendarString } from '@/lib/dates/ui-date';
import { parseSapAmount, parseSapQty, txnTypeForMvt } from '@/modules/spare-stock-analysis/server/txn-type';
import type { SpareStockParsedRow } from '@/modules/spare-stock-analysis/types';

function cellText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normHeader(raw: string): string {
  return cellText(raw).toLowerCase().replace(/\s+/g, ' ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sapDateToIso(raw: string): string | null {
  const cal = parseCalendarString(raw);
  if (!cal) return null;
  const y = Number(cal.year);
  const m = Number(cal.month);
  const d = Number(cal.day);
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

type ColMap = {
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

function mapHeaders(cells: string[]): ColMap | null {
  const idx = (pred: (h: string) => boolean): number => cells.findIndex(pred);
  const plant = idx((h) => h === 'plnt' || h === 'plant');
  const mvt = idx((h) => h === 'mvt' || h === 'mv t');
  const qty = idx((h) => h === 'qty in une' || h === 'qty in un e' || h.startsWith('qty in'));
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
    sapUser: idx((h) => h === 'user'),
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

export function movementRowKey(parts: {
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
}): string {
  return createHash('sha256')
    .update(
      [
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
      ].join('|')
    )
    .digest('hex');
}

export function parseMb51Html(html: string): { rows: SpareStockParsedRow[]; skipped: number } {
  const $ = cheerio.load(html);
  let colMap: ColMap | null = null;
  const rows: SpareStockParsedRow[] = [];
  let skipped = 0;

  $('tr').each((_, tr) => {
    const cells = $(tr)
      .find('td, th')
      .map((__, td) => cellText($(td).text()))
      .get();
    if (cells.length < 6) return;

    if (!colMap) {
      colMap = mapHeaders(cells.map(normHeader));
      return;
    }

    const plant = pick(cells, colMap.plant).replace(/\s+/g, '');
    if (!isDataPlant(plant)) {
      skipped += 1;
      return;
    }

    const postingRaw = pick(cells, colMap.postingDate) || pick(cells, colMap.docDate);
    const postingDate = sapDateToIso(postingRaw);
    if (!postingDate) {
      skipped += 1;
      return;
    }

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

    rows.push({
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
      rowKey: movementRowKey({
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
    });
  });

  if (!colMap) {
    throw new Error(
      'Could not find header row (expected Plnt/Plant, Material, MvT, Qty in UnE, Pstng Date)'
    );
  }

  return { rows, skipped };
}
