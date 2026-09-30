import { extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';

export {
  applyUneToKg,
  effectForTxnType,
  parseSapAmount,
  parseSapQty,
  txnTypeForMvt,
} from '@/modules/spare-stock-analysis/sap-numbers';

export const DEFECTIVE_COMPRESSOR_MATERIAL = '2303393';

/** First extracted call, or empty if Text is not a call (invoice, name, etc). */
export function normalizeCallNo(raw: string): string {
  return extractCallNumbers(raw)[0] ?? '';
}
