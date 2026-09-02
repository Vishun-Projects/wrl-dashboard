import type { CancelledCallRow } from '@/modules/cancelled-calls/types';
import { formatCancelledCallFranchisee } from '@/modules/cancelled-calls/franchisee-label';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';
import { escapeCsvCell } from '@/lib/utils/csv';

export const CANCELLED_CALLS_CSV_HEADERS = [
  'TRN',
  'Call Date',
  'Cancelled At',
  'Branch',
  'Franchisee',
  'Party',
  'Party Profile',
  'Call Type',
  'Item Code',
  'Serial',
  'Complaint',
  'Cancel Reason',
  'Region',
] as const;

export type CancelledCallCsvDbRow = {
  vtrnno: string;
  logged_at: Date | string;
  cancelled_at: Date | string;
  branch_name: string | null;
  franchisee_name: string | null;
  franchisee_vendor_code: string | null;
  party_name: string | null;
  account: string | null;
  call_type: string | null;
  item_code: string | null;
  serial: string | null;
  complaint: string | null;
  cancel_reason: string | null;
  ncancelreason: number | string | null;
  region: string | null;
};

function cancelReasonText(row: CancelledCallCsvDbRow): string {
  const reasonText = String(row.cancel_reason ?? '').trim();
  const ncr = Number(row.ncancelreason) || 0;
  return reasonText || (ncr ? String(ncr) : '');
}

function partyProfileText(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text || text.toUpperCase() === 'UNCLASSIFIED') return '';
  return text;
}

function cancelledCallRowToCells(row: CancelledCallRow | CancelledCallCsvDbRow): string[] {
  const isDigestRow = 'loggedAt' in row;
  const db = isDigestRow
    ? {
        vtrnno: row.vtrnno,
        logged_at: row.loggedAt,
        cancelled_at: row.cancelledAt,
        branch_name: row.branchName,
        franchisee_name: row.franchiseeName,
        franchisee_vendor_code: row.franchiseeVendorCode,
        party_name: row.partyName,
        account: row.partyProfile,
        call_type: row.callType,
        item_code: row.itemCode,
        serial: row.serial,
        complaint: row.complaint,
        cancel_reason: row.cancelReason,
        ncancelreason: row.ncancelreason,
        region: row.region,
      }
    : row;
  return [
    db.vtrnno,
    formatUiDate(db.logged_at),
    formatUiDateTime(db.cancelled_at),
    db.branch_name ?? '',
    formatCancelledCallFranchisee(db.franchisee_vendor_code, db.franchisee_name),
    db.party_name ?? '',
    partyProfileText(db.account),
    db.call_type ?? '',
    db.item_code ?? '',
    db.serial ?? '',
    db.complaint ?? '',
    cancelReasonText(db),
    db.region ?? '',
  ];
}

export function cancelledCallDbRowToCsvLine(row: CancelledCallCsvDbRow): string {
  return cancelledCallRowToCells(row).map(escapeCsvCell).join(',');
}

export function cancelledCallRowToExportValues(row: CancelledCallRow): string[] {
  return cancelledCallRowToCells(row);
}

export function buildCancelledCallsCsv(rows: CancelledCallRow[]): string {
  const lines = [CANCELLED_CALLS_CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(cancelledCallRowToCells(row).map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}
