import { describe, expect, it } from 'vitest';
import { transformCrmRowToHot } from '@/lib/read-model/transform';

function baseCrmRow(overrides: Record<string, unknown> = {}) {
  return {
    ncode: 1,
    id: 1,
    vtrnno: '26G13251',
    UniqueCallNo: '26G13251',
    nofficeid: 1100,
    officeId: 1100,
    callsdtrndate: '2026-07-13T11:08:41',
    dtrndate: '2026-07-13T11:08:41',
    callsvserialno: '41748251201661',
    PartyName: 'ADOR ICE CREAM',
    office_name: 'WESTERN HEAD OFFICE',
    officename: 'WESTERN HEAD OFFICE',
    region: 'NORTH',
    account: 'UNCLASSIFIED',
    Status: 'Assigned',
    callstatus: 'Open',
    bsolved: 0,
    bfastclose: 0,
    ncancelreason: 0,
    ...overrides,
  };
}

describe('transformCrmRowToHot WCO', () => {
  it('maps WCO letter onto hot row', () => {
    const hot = transformCrmRowToHot(baseCrmRow({ WCO: 'W' }));
    expect(hot?.wco).toBe('W');
  });

  it('stores null when WCO missing (no serial link)', () => {
    const hot = transformCrmRowToHot(baseCrmRow({ WCO: null, callsvserialno: '' }));
    expect(hot?.wco).toBeNull();
  });

  it('rejects unexpected WCO values', () => {
    const hot = transformCrmRowToHot(baseCrmRow({ WCO: 'X' }));
    expect(hot?.wco).toBeNull();
  });
});
