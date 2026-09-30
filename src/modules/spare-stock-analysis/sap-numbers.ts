import type { SpareStockTxnType } from '@/modules/spare-stock-analysis/types';

const TXN_BY_MVT: Record<string, SpareStockTxnType> = {
  '561': 'opening',
  '941': 'issued',
  '942': 'issued',
  '801': 'issued',
  '802': 'issued',
  '945': 'receipt',
  '946': 'receipt',
  '951': 'receipt',
  '952': 'receipt',
  '853': 'receipt',
  '854': 'receipt',
  '943': 'consumption',
  '944': 'consumption',
  '947': 'consumption',
  '948': 'consumption',
  '949': 'consumption',
};

/** Stock effect for mapped kinds: opening/issued add; receipt/consumption reduce. */
export function effectForTxnType(txnType: SpareStockTxnType): 1 | -1 | 0 {
  if (txnType === 'opening' || txnType === 'issued') return 1;
  if (txnType === 'receipt' || txnType === 'consumption') return -1;
  return 0;
}

export function txnTypeForMvt(mvt: string): SpareStockTxnType {
  return TXN_BY_MVT[mvt.replace(/\s+/g, '')] ?? 'other';
}

const GRAM_UOM = new Set(['G', 'GM', 'GMS', 'GRM']);

/** Exact G/GM/GMS/GRM → divide qty by 1000 and normalize UOM to KG. KG left alone. */
export function applyUneToKg(uom: string, qty: number): { uom: string; qty: number } {
  const key = uom.replace(/\s+/g, '').toUpperCase();
  if (!GRAM_UOM.has(key)) return { uom, qty };
  return { uom: 'KG', qty: qty / 1000 };
}

/** SAP trailing minus (`1.000-`) is negative. Leading minus kept as-is. */
function sapSignedNumber(raw: string): number {
  let t = raw.replace(/\s+/g, '').replace(/,/g, '');
  if (!t) return NaN;
  let neg = false;
  if (t.endsWith('-')) {
    neg = true;
    t = t.slice(0, -1);
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/** SAP UnE qty: `1.000` / `    2.000 ` / `1.000-` — comma thousands stripped, dot decimal. */
export function parseSapQty(raw: string): number {
  const n = sapSignedNumber(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseSapAmount(raw: string): number | null {
  const n = sapSignedNumber(raw);
  return Number.isFinite(n) ? n : null;
}
