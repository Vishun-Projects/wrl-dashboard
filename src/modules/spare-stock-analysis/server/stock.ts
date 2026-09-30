import { effectForTxnType } from '@/modules/spare-stock-analysis/sap-numbers';
import type { SpareStockKpis, SpareStockTxnType } from '@/modules/spare-stock-analysis/types';

/** Legacy 561 is stock as on this date; roll-forward prior window starts the next day. */
export const SPARE_STOCK_LEGACY_OPENING_DATE = '2025-01-31';
export const SPARE_STOCK_ROLL_FLOOR = '2025-02-01';

export type StockInputRow = {
  txnType: SpareStockTxnType;
  postingDate: string;
  qty: number;
};

export type CleanPairRow = {
  plant: string;
  matDoc: string;
  material: string;
  mvt: string;
  qty: number;
  location: string;
};

/**
 * Rule 3: plant+matDoc+material+abs(qty)+mvt with both debit and credit
 * → keep blank storage location only.
 */
export function cleanDebitCreditPairs<T extends CleanPairRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = [r.plant, r.matDoc, r.material, String(Math.abs(r.qty)), r.mvt].join('|');
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: T[] = [];
  for (const list of groups.values()) {
    const hasPos = list.some((r) => r.qty > 0);
    const hasNeg = list.some((r) => r.qty < 0);
    if (hasPos && hasNeg) {
      for (const r of list) {
        if (!r.location.trim()) out.push(r);
      }
    } else {
      out.push(...list);
    }
  }
  return out;
}

/**
 * Opening (BOP):
 * - start ≤ 2025-01-31 → 0, plus in-period 561
 * - else → all 561 + mapped non-opening effect on [2025-02-01, start)
 * Period issued/receipt/consumption use effect × |qty| (receipt/consumption negative).
 * Closing = Opening + Issued + Receipt + Consumption.
 */
export function computeStockKpis(rows: StockInputRow[], start: string, end: string): SpareStockKpis {
  let opening = 0;
  let received = 0;
  let issued = 0;
  let consumption = 0;
  const bopBeforeLegacy = start <= SPARE_STOCK_LEGACY_OPENING_DATE;

  for (const r of rows) {
    if (r.txnType === 'other') continue;
    const effect = effectForTxnType(r.txnType);
    if (!effect) continue;
    const mag = Math.abs(r.qty);
    const d = r.postingDate;

    if (r.txnType === 'opening') {
      if (bopBeforeLegacy) {
        if (d >= start && d <= end) opening += mag;
      } else {
        opening += mag;
      }
      continue;
    }

    if (!bopBeforeLegacy && d >= SPARE_STOCK_ROLL_FLOOR && d < start) {
      opening += effect * mag;
    }

    if (d >= start && d <= end) {
      const signed = effect * mag;
      if (r.txnType === 'receipt') received += signed;
      else if (r.txnType === 'issued') issued += signed;
      else if (r.txnType === 'consumption') consumption += signed;
    }
  }

  return {
    opening,
    received,
    issued,
    consumption,
    closing: opening + issued + received + consumption,
  };
}
