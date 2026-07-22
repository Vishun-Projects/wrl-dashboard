import { describe, expect, it } from 'vitest';
import {
  filterSerialPanelRows,
  sortSerialPanelRows,
  type SerialPanelFilters,
} from './serial-panel';
import type { CallRegisterSerialExportRow } from './shape';

const rows: CallRegisterSerialExportRow[] = [
  {
    client: 'Nestle',
    serial: 'BBB',
    qtyDate: '2026-07-02',
    deploymentDate: '',
    installationDate: '2026-07-05',
    pendingDeploy: 'Yes',
    pendingInstall: 'No',
  },
  {
    client: 'Nestle',
    serial: 'AAA',
    qtyDate: '2026-07-01',
    deploymentDate: '2026-07-03',
    installationDate: '',
    pendingDeploy: 'No',
    pendingInstall: 'Yes',
  },
];

describe('call-register serial panel filter/sort', () => {
  it('filters by serial search', () => {
    const filters: SerialPanelFilters = {
      search: 'aa',
      pendingDeploy: 'all',
      pendingInstall: 'all',
    };
    const filtered = filterSerialPanelRows(rows, filters);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.serial).toBe('AAA');
  });

  it('filters by pending deploy', () => {
    const pendingDeploy = filterSerialPanelRows(rows, {
      search: '',
      pendingDeploy: 'Yes',
      pendingInstall: 'all',
    });
    expect(pendingDeploy).toHaveLength(1);
    expect(pendingDeploy[0]?.serial).toBe('BBB');
  });

  it('sorts by serial ascending', () => {
    const sorted = sortSerialPanelRows(rows, 'serial', 'asc');
    expect(sorted[0]?.serial).toBe('AAA');
    expect(sorted[1]?.serial).toBe('BBB');
  });
});
