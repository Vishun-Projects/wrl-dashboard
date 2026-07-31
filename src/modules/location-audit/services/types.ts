import type { RegisterDateFilterColumn } from '@/sql/trhcalls/query';

/** Cap for CRM TOP / list analysis (was REPORT_MAX_ROWS from deleted sync proxy). */
export const LOCATION_AUDIT_MAX_ROWS = 2000;
export const LOCATION_AUDIT_LIST_PAGE_SIZE = 50;

/** Safe CRM `TOP n` — undefined/NaN must never reach SQL (`SELECT TOP NaN`). */
export function clampLocationAuditLimit(limit?: number): number {
  const requested = limit ?? LOCATION_AUDIT_MAX_ROWS;
  if (!Number.isFinite(requested) || requested <= 0) return LOCATION_AUDIT_MAX_ROWS;
  return Math.min(requested, LOCATION_AUDIT_MAX_ROWS);
}

export type LocationAuditStatus = 'mismatch' | 'ok' | 'no_gps' | 'no_address';

export type LocationAuditFraudSignal = 'pincode_mismatch' | 'none';

export type LocationAuditSeverity = 'flag' | 'review' | 'ok' | 'incomplete';

export type LocationAuditSignalResult = {
  pass: boolean;
  reason: string;
};

export type LocationAuditSignals = {
  pincode: LocationAuditSignalResult;
  distance: LocationAuditSignalResult;
  addressPin: LocationAuditSignalResult;
  visit: LocationAuditSignalResult;
};

export type LocationAuditListRow = {
  vtrnno: string;
  ncode: string;
  officeId: string;
  vcclid: string;
  callDate: string;
  callType: string;
  repairPriority: string;
  callStatus: string;
  partyName: string;
  address: string;
  pincode: string;
  city: string;
  state: string;
  branchName: string;
  officeName: string;
  franchiseeName: string;
  franchiseeCode: string;
  technicianName: string;
  crmLat: number | null;
  crmLng: number | null;
  gpsSource: import('@/lib/geo/parse-latlong').CrmGpsSource;
  storedGpsRaw: string;
  status: LocationAuditStatus;
  fraudSignal: LocationAuditFraudSignal;
  pincodeInAddress: string;
  storedGpsPincode: string;
  storedGpsPincodeArea: string;
  pincodeMatchStatus: 'same' | 'different' | 'unknown';
  pincodeCheckNote: string;
  gpsToInstallAreaKm: number | null;
  severity: LocationAuditSeverity;
  mismatchExplanation: string;
};

export type LocationAuditDetailRow = LocationAuditListRow & {
  expectedInstallLat: number | null;
  expectedInstallLng: number | null;
  installGeocodeMethod: string;
  installGeocodeArea: string;
  distanceToInstallM: number | null;
  visitLat: number | null;
  visitLng: number | null;
  visitGpsSource: string | null;
  visitDatetime: string;
  distanceVisitToInstallM: number | null;
  distanceVisitToStoredM: number | null;
  signals: LocationAuditSignals;
  severity: LocationAuditSeverity;
};

/** @deprecated Use LocationAuditListRow */
export type LocationAuditRow = LocationAuditDetailRow;

export type LocationAuditSummary = {
  totalCalls: number;
  analyzedCap: number;
  withCrmGps: number;
  pincodeMismatch: number;
  farFromInstall: number;
  pincodeMatch: number;
  missingAddress: number;
  missingCrmGps: number;
  pincodeUnknown: number;
  missingInstallPincode: number;
  addressPincodeConflict: number;
  flagged: number;
  review: number;
  /** @deprecated Use farFromInstall */
  mismatchOver1km?: number;
  /** @deprecated */
  within1km?: number;
};

/** Install address pincode differs from pincode at stored GPS (primary audit signal). */
export function isPincodeMismatchRow(row: LocationAuditListRow): boolean {
  return row.pincodeMatchStatus === 'different' || row.fraudSignal === 'pincode_mismatch';
}

export function filterPincodeMismatchRows(rows: LocationAuditListRow[]): LocationAuditListRow[] {
  return rows.filter(isPincodeMismatchRow);
}

export function filterLocationAuditListRows(
  rows: LocationAuditListRow[],
  opts: { mismatchesOnly?: boolean; pincodeMismatchOnly?: boolean } = {}
): LocationAuditListRow[] {
  if (opts.pincodeMismatchOnly ?? opts.mismatchesOnly ?? true) {
    return filterPincodeMismatchRows(rows);
  }
  return rows;
}

export type LocationAuditByBranch = {
  branch: string;
  pincodeMismatch: number;
  mismatchOver1km: number;
  total: number;
};

export type LocationAuditQueryParams = {
  startDate: string;
  endDate: string;
  callType?: string | null;
  officeId?: string | null;
  franchisee?: string | null;
  branch?: string | null;
  technician?: string | null;
  pincode?: string | null;
  state?: string | null;
  city?: string | null;
  isHod: boolean;
  assignedOffices: string[];
  dateColumn?: RegisterDateFilterColumn;
  limit?: number;
  page?: number;
  pageSize?: number;
};

export type LocationAuditPhase = 'loading_calls' | 'calls_loaded' | 'analyzing' | 'complete';
