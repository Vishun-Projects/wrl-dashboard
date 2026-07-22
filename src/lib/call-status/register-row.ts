import { isRealCancelReasonCode } from '@/lib/call-status/cancel';

export type RegisterSummaryBucket =
  | 'openUnallocated'
  | 'assigned'
  | 'techSolved'
  | 'closed'
  | 'cancelled'
  | 'transferred';

export function isRegisterRowTransferred(row: Record<string, unknown>): boolean {
  return (
    Boolean(row.vtransfercallno && String(row.vtransfercallno).trim() !== '') ||
    String(row.ncancelreason) === '2'
  );
}

/** CRM / Postgres flags arrive as boolean, 0/1, or 'True'/'False' strings. */
export function truthyCrmFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function isRegisterRowCancelled(row: Record<string, unknown>): boolean {
  if (isRegisterRowTransferred(row)) return false;
  if (row.callstatus === 'Cancel' || row.Status === 'Cancel') return true;
  const statusText = String(row.Status ?? row.callStatus ?? '').toLowerCase();
  if (statusText.includes('cancel')) return true;
  const reason = row.ncancelreason ?? row.ncancelReason;
  if (isRealCancelReasonCode(reason)) return true;
  const cancelReason = row.cancel_reason;
  if (cancelReason != null && String(cancelReason).trim() !== '') return true;
  return false;
}

export function classifyRegisterRowStatus(row: Record<string, unknown>): RegisterSummaryBucket {
  if (isRegisterRowTransferred(row)) return 'transferred';

  const isCancelled = isRegisterRowCancelled(row);
  const isClosed =
    !isCancelled &&
    (row.Status === 'Closed' ||
      row.callstatus === 'Solved' ||
      truthyCrmFlag(row.callsolved) ||
      truthyCrmFlag(row.bsolved));
  const isTechSolved = truthyCrmFlag(row.bfastclose) && !isClosed && !isCancelled;
  const isAssigned =
    Boolean(row.nengineer && String(row.nengineer) !== '0') &&
    !isClosed &&
    !isCancelled &&
    !isTechSolved;

  if (isCancelled) return 'cancelled';
  if (isClosed) return 'closed';
  if (isTechSolved) return 'techSolved';
  if (isAssigned) return 'assigned';
  return 'openUnallocated';
}

export function isMajorRepairRow(row: Record<string, unknown>): boolean {
  const v = row.is_major_repair;
  if (v == null || v === '') return false;
  const normalized = String(v).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
