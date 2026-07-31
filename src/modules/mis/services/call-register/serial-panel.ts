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

/** Normalize dd/mm/yyyy (or ISO) so string compare is chronological. */
function sortableDate(value: string): string {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return value;
}

const DATE_SORT_KEYS = new Set<SerialPanelSortKey>([
  'qtyDate',
  'deploymentDate',
  'installationDate',
]);

export function sortSerialPanelRows(
  rows: CallRegisterSerialExportRow[],
  sortKey: SerialPanelSortKey,
  sortDir: 'asc' | 'desc'
): CallRegisterSerialExportRow[] {
  const mul = sortDir === 'asc' ? 1 : -1;
  const isDate = DATE_SORT_KEYS.has(sortKey);
  return [...rows].sort((a, b) => {
    const rawA = a[sortKey] || '';
    const rawB = b[sortKey] || '';
    const av = isDate ? sortableDate(rawA) : rawA;
    const bv = isDate ? sortableDate(rawB) : rawB;
    if (av < bv) return -1 * mul;
    if (av > bv) return 1 * mul;
    return a.serial.localeCompare(b.serial);
  });
}
