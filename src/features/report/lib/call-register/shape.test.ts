import { describe, expect, it } from 'vitest';
import { shapeSerialExportRow } from './shape';
import { monthChunks } from './sql';

describe('call-register serial export shape', () => {
  it('marks pending install/deploy when dates missing', () => {
    const pending = shapeSerialExportRow({
      client: 'Reliance Campa Cola',
      serial: '32585260513937',
      qtyDate: '11/06/2026 01:22:09',
      installationDate: null,
      deploymentDate: undefined,
    });
    expect(pending.qtyDate).toBe('2026-06-11');
    expect(pending.installationDate).toBe('');
    expect(pending.deploymentDate).toBe('');
    expect(pending.pendingInstall).toBe('Yes');
    expect(pending.pendingDeploy).toBe('Yes');
  });

  it('formats install/deploy dates when present', () => {
    const done = shapeSerialExportRow({
      client: 'Reliance Campa Cola',
      serial: '32585260513937',
      qtyDate: '2026-02-06',
      installationDate: new Date('2026-03-15T10:00:00Z'),
      deploymentDate: '2026-04-01T12:00:00.000Z',
    });
    expect(done.installationDate).toBe('2026-03-15');
    expect(done.deploymentDate).toBe('2026-04-01');
    expect(done.pendingInstall).toBe('No');
    expect(done.pendingDeploy).toBe('No');
  });

  it('splits date ranges into month chunks', () => {
    const chunks = monthChunks('2026-01-15', '2026-03-10');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ from: '2026-01-15', to: '2026-01-31' });
    expect(chunks[1]).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(chunks[2]).toEqual({ from: '2026-03-01', to: '2026-03-10' });
  });
});
