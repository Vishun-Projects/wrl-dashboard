import type { CancelledCallRow } from '@/modules/cancelled-calls/types';
import { formatCancelledCallFranchisee } from '@/modules/cancelled-calls/franchisee-label';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const HEADERS = [
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

export function buildCancelledCallsCsv(rows: CancelledCallRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.vtrnno,
        formatUiDate(row.loggedAt),
        formatUiDateTime(row.cancelledAt),
        row.branchName ?? '',
        formatCancelledCallFranchisee(row.franchiseeVendorCode, row.franchiseeName),
        row.partyName ?? '',
        row.partyProfile ?? '',
        row.callType ?? '',
        row.itemCode ?? '',
        row.serial ?? '',
        row.complaint ?? '',
        row.cancelReason,
        row.region ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}
