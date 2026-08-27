import type { CancelledCallRow } from '@/modules/cancelled-calls/types';
import { formatUiDateTime } from '@/lib/dates/ui-date';

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const HEADERS = [
  'TRN',
  'Cancelled At',
  'Logged At',
  'Branch',
  'Party',
  'Call Type',
  'Item',
  'Serial',
  'Engineer',
  'Complaint',
  'Cancel Reason',
  'Region',
  'Account',
] as const;

export function buildCancelledCallsCsv(rows: CancelledCallRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.vtrnno,
        formatUiDateTime(row.cancelledAt),
        formatUiDateTime(row.loggedAt),
        row.branchName ?? '',
        row.partyName ?? '',
        row.callType ?? '',
        row.itemName ?? '',
        row.serial ?? '',
        row.engineerName ?? '',
        row.complaint ?? '',
        row.cancelReason,
        row.region ?? '',
        row.account ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}
