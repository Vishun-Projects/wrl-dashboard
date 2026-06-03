import { escapeCsvCell } from '@/lib/utils/csv';
import type { WarrantyMasterAggregateRow } from './types';

export function exportWarrantyMasterCsv(rows: WarrantyMasterAggregateRow[]): string {
  const headers = ['Customer', 'Group', 'Warranty period (in Months)', 'Count of M/c'];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [r.customerName, r.groupName, r.warrantyMonths, r.machineCount].map(escapeCsvCell).join(',')
    ),
  ];
  return lines.join('\r\n');
}
