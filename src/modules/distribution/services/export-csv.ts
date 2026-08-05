import { escapeCsvCell } from '@/lib/utils/csv';

type DistributionFranchiseeCsvRow = {
  franchisee_code: string;
  franchisee_name: string;
  technicians_count: number;
  total_calls: number;
  open_calls: number;
  ratio: number;
};

type DistributionIdleCsvRow = {
  name: string;
  branchName: string;
  franchiseeName?: string;
  issue: string;
  assignedCalls: number;
  totalCalls: number;
};

export function exportDistributionFranchiseeCsv(rows: DistributionFranchiseeCsvRow[]): string {
  const headers = ['Franchisee code', 'Franchisee', 'Techs', 'Total calls', 'Open calls', 'Ratio'];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [
        r.franchisee_code,
        r.franchisee_name,
        r.technicians_count,
        r.total_calls,
        r.open_calls,
        r.ratio,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
}

export function exportDistributionIdleCsv(rows: DistributionIdleCsvRow[]): string {
  const headers = ['Technician', 'Branch', 'Franchisee', 'Status', 'Assigned', 'Total'];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) =>
      [r.name, r.branchName, r.franchiseeName ?? '', r.issue, r.assignedCalls, r.totalCalls]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n');
}
