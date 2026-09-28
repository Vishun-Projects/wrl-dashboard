import type { SpareStockKpis, SpareStockTxnType } from '@/modules/spare-stock-analysis/types';

export type StockInputRow = {
  txnType: SpareStockTxnType;
  postingDate: string;
  qty: number;
};

export function computeStockKpis(rows: StockInputRow[], start: string, end: string): SpareStockKpis {
  let opening561 = 0;
  let priorIn = 0;
  let priorOut = 0;
  let received = 0;
  let issued = 0;
  let consumption = 0;

  for (const r of rows) {
    if (r.txnType === 'other') continue;
    const d = r.postingDate;
    const mag = Math.abs(r.qty);
    if (r.txnType === 'opening' && d <= end) opening561 += mag;
    if (d < start) {
      if (r.txnType === 'receipt') priorIn += mag;
      else if (r.txnType === 'issued' || r.txnType === 'consumption') priorOut += mag;
    }
    if (d >= start && d <= end) {
      if (r.txnType === 'receipt') received += mag;
      else if (r.txnType === 'issued') issued += mag;
      else if (r.txnType === 'consumption') consumption += mag;
    }
  }

  const opening = opening561 + priorIn - priorOut;
  return {
    opening,
    received,
    issued,
    consumption,
    closing: opening + received - issued - consumption,
  };
}
