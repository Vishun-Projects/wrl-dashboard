import type { CallRegisterSerialExportRow } from './shape';

export type SerialPanelSortKey =
  | 'serial'
  | 'qtyDate'
  | 'deploymentDate'
  | 'installationDate'
  | 'pendingDeploy'
  | 'pendingInstall';

export type SerialPanelFilters = {
  search: string;
  pendingDeploy: 'all' | 'Yes' | 'No';
  pendingInstall: 'all' | 'Yes' | 'No';
};

export function filterSerialPanelRows(
  rows: CallRegisterSerialExportRow[],
  filters: SerialPanelFilters
): CallRegisterSerialExportRow[] {
  const q = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (q && !row.serial.toLowerCase().includes(q)) return false;
    if (filters.pendingDeploy !== 'all' && row.pendingDeploy !== filters.pendingDeploy) return false;
    if (filters.pendingInstall !== 'all' && row.pendingInstall !== filters.pendingInstall) return false;
    return true;
  });
}

export function sortSerialPanelRows(
  rows: CallRegisterSerialExportRow[],
  sortKey: SerialPanelSortKey,
  sortDir: 'asc' | 'desc'
): CallRegisterSerialExportRow[] {
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey] || '';
    const bv = b[sortKey] || '';
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return a.serial.localeCompare(b.serial);
  });
}
