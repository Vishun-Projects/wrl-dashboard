import { extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';
import type { SpareStockTxnType } from '@/modules/spare-stock-analysis/types';

const TXN_BY_MVT: Record<string, SpareStockTxnType> = {
  '561': 'opening',
  '853': 'receipt',
  '952': 'receipt',
  '801': 'issued',
  '941': 'issued',
  '942': 'issued',
  '943': 'consumption',
  '944': 'consumption',
  '947': 'consumption',
  '948': 'consumption',
  '949': 'consumption',
};

export function txnTypeForMvt(mvt: string): SpareStockTxnType {
  return TXN_BY_MVT[mvt.replace(/\s+/g, '')] ?? 'other';
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

export const DEFECTIVE_COMPRESSOR_MATERIAL = '2303393';

/** First extracted call, or empty if Text is not a call (invoice, name, etc). */
export function normalizeCallNo(raw: string): string {
  return extractCallNumbers(raw)[0] ?? '';
}
