import { isRealCancelReasonCode } from '@/lib/call/status/cancel';
import type {
  SpareLoanCallLookup,
  SpareLoanMatchSource,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
  Zss02ParsedRow,
} from '@/modules/spare-loan-check/types';

/** Call-like SO: e.g. 25B22681, 24L283315 — not Buffer / names. */
export const CALL_LIKE_SO_RE = /^\d{2}[A-Za-z]\d+$/;

export function isCallLikeSo(value: string): boolean {
  return CALL_LIKE_SO_RE.test(value.trim());
}

export function selectMatchKey(
  soLoan: string,
  soConRtn: string
): { key: string; source: SpareLoanMatchSource } | null {
  const loan = soLoan.trim();
  const con = soConRtn.trim();
  if (loan && isCallLikeSo(loan)) {
    return { key: loan.toUpperCase(), source: 'loan' };
  }
  if (con) {
    return { key: con.toUpperCase(), source: 'con_rtn' };
  }
  return null;
}

/** Leading digits only (e.g. 305632-BLK → 305632). Same rule as subcontractor stock. */
function normalizeVendorCode(code: string): string {
  const match = code.trim().match(/^(\d+)/);
  return match ? match[1] : code.trim();
}

export function vendorsMatch(htmlVendor: string, crmVendor: string | null | undefined): boolean {
  const a = normalizeVendorCode(htmlVendor ?? '');
  const b = normalizeVendorCode(crmVendor ?? '');
  if (!a || !b) return false;
  return a === b;
}

export function isLookupCancelled(call: SpareLoanCallLookup): boolean {
  if (call.transferred) return false;
  if (call.statusBucket === 'cancelled') return true;
  return isRealCancelReasonCode(call.ncancelreason);
}

/**
 * Classify one SAP row against CRM lookup.
 * Returns null when clean match or SO not in CRM (both hidden).
 * Transferred → vendor_mismatch (same bucket for display).
 * Cancelled with no CRM vendor → unassigned_cancelled.
 */
export function classifySpareLoanRow(
  htmlVendor: string,
  call: SpareLoanCallLookup | undefined
): SpareLoanProblemReason | null {
  if (!call) return null;
  if (call.transferred) return 'vendor_mismatch';
  const cancelled = isLookupCancelled(call);
  const vendorOk = vendorsMatch(htmlVendor, call.vendorCode);
  if (cancelled) {
    const crmVendor = normalizeVendorCode(call.vendorCode ?? '');
    if (!crmVendor) return 'unassigned_cancelled';
    return 'cancelled';
  }
  if (!vendorOk) return 'vendor_mismatch';
  return null;
}

export function toProblemRow(
  row: Zss02ParsedRow,
  match: { key: string; source: SpareLoanMatchSource },
  reason: SpareLoanProblemReason,
  call: SpareLoanCallLookup | undefined,
  itemCategory: string | null = null
): SpareLoanProblemRow {
  return {
    plant: row.plant,
    vendorNo: row.vendorNo,
    vendorName: row.vendorName,
    material: row.material,
    materialDescription: row.materialDescription,
    itemCategory,
    barcode: row.barcode,
    soLoan: row.soLoan,
    soConRtn: row.soConRtn,
    matchKey: match.key,
    matchSource: match.source,
    crmVtrnno: call?.vtrnno ?? null,
    crmVendorCode: call?.vendorCode ?? null,
    crmVendorName: call?.vendorName ?? null,
    reason,
    cancelReason: call?.cancelReason ?? null,
    callLoggedAt: call?.loggedAt ?? null,
    lastEditedAt: call?.lastEditedAt ?? null,
  };
}
