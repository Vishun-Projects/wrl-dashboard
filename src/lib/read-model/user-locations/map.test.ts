import { describe, expect, it } from 'vitest';
import { mapCrmUserLocationRow } from './map';

describe('mapCrmUserLocationRow', () => {
  it('maps CRM msduserlocation columns', () => {
    const mapped = mapCrmUserLocationRow({
      ncode: '9001',
      nuser: '42',
      nofficeid: '1100',
      vlatlong: '19.07,72.87',
      addedon: '2026-08-24T10:15:00',
      acode: 'A1',
      ACTION_TYPE: 'CHECKIN',
      Distance: '1.25',
      ncodetrn: '55',
      vtrnno: '26F01029',
      vcustomername: 'Acme',
      vtravelmode: 'Bike',
    });
    expect(mapped).toMatchObject({
      ncode: 9001,
      user_id: 42,
      office_id: 1100,
      latlong: '19.07,72.87',
      action_type: 'CHECKIN',
      distance: 1.25,
      trn_no: '26F01029',
      customer_name: 'Acme',
      travel_mode: 'Bike',
    });
  });

  it('keeps fractional nuser (do not truncate)', () => {
    const mapped = mapCrmUserLocationRow({
      ncode: '2220257',
      nuser: '590.3000000000',
      nofficeid: '590',
      ACTION_TYPE: 'SERVICE START',
      vtrnno: '26H17669',
    });
    expect(mapped?.user_id).toBe(590.3);
    expect(mapped?.office_id).toBe(590);
  });

  it('drops rows without ncode', () => {
    expect(mapCrmUserLocationRow({ nuser: '1' })).toBeNull();
  });
});
