import { shapeSerialExportRow } from './shape';
import { monthChunks } from './sql';

{
  const pending = shapeSerialExportRow({
    client: 'Reliance Campa Cola',
    serial: '32585260513937',
    qtyDate: '11/06/2026 01:22:09',
    installationDate: null,
    deploymentDate: undefined,
  });
  console.assert(pending.qtyDate === '2026-06-11', 'qtyDate from CRM daddedon');
  console.assert(pending.installationDate === '', 'empty install date');
  console.assert(pending.deploymentDate === '', 'empty deploy date');
  console.assert(pending.pendingInstall === 'Yes', 'pending install when no date');
  console.assert(pending.pendingDeploy === 'Yes', 'pending deploy when no date');

  const done = shapeSerialExportRow({
    client: 'Reliance Campa Cola',
    serial: '32585260513937',
    qtyDate: '2026-02-06',
    installationDate: new Date('2026-03-15T10:00:00Z'),
    deploymentDate: '2026-04-01T12:00:00.000Z',
  });
  console.assert(done.installationDate === '2026-03-15', 'install date from Date');
  console.assert(done.deploymentDate === '2026-04-01', 'deploy date from ISO');
  console.assert(done.pendingInstall === 'No', 'not pending when installed');
  console.assert(done.pendingDeploy === 'No', 'not pending when deployed');

  const chunks = monthChunks('2026-01-15', '2026-03-10');
  console.assert(chunks.length === 3, 'three month chunks');
  console.assert(chunks[0].from === '2026-01-15' && chunks[0].to === '2026-01-31');
  console.assert(chunks[1].from === '2026-02-01' && chunks[1].to === '2026-02-28');
  console.assert(chunks[2].from === '2026-03-01' && chunks[2].to === '2026-03-10');

  console.log('ok: call-register serial export shape');
}
