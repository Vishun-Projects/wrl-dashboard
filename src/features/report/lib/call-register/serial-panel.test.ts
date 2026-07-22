import {
  filterSerialPanelRows,
  sortSerialPanelRows,
  type SerialPanelFilters,
} from './serial-panel';
import type { CallRegisterSerialExportRow } from './shape';

{
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

  const filters: SerialPanelFilters = {
    search: 'aa',
    pendingDeploy: 'all',
    pendingInstall: 'all',
  };
  const filtered = filterSerialPanelRows(rows, filters);
  console.assert(filtered.length === 1 && filtered[0].serial === 'AAA', 'search filter');

  const pendingDeploy = filterSerialPanelRows(rows, {
    search: '',
    pendingDeploy: 'Yes',
    pendingInstall: 'all',
  });
  console.assert(pendingDeploy.length === 1 && pendingDeploy[0].serial === 'BBB', 'pending deploy filter');

  const sorted = sortSerialPanelRows(rows, 'serial', 'asc');
  console.assert(sorted[0].serial === 'AAA' && sorted[1].serial === 'BBB', 'sort serial asc');

  console.log('ok: call-register serial panel filter/sort');
}
