import { escapeCsvCell } from '@/lib/utils/csv';
import type { SerialAuditRow } from '@/features/serial-audit/lib/complaint-audit';

export function exportSerialAuditCsv(rows: SerialAuditRow[]): string {
  const headers = [
    'Serial',
    'Complaints',
    'Open',
    'Solved',
    'Cancelled',
    'Branches',
    'Customers',
    'Last date',
    'Flagged',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.serial,
        r.complaintCount,
        r.openCount,
        r.solvedCount,
        r.cancelledCount,
        r.uniqueBranches.join('; '),
        r.uniqueCustomers.join('; '),
        r.lastComplaintDate ?? '',
        r.riskFlag ? 'Y' : '',
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
}
