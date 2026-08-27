import { describe, expect, it } from 'vitest';
import { mapsUrlFromLatLong } from './maps-url';
import { buildUserLocationListWhere } from './user-locations';

describe('user-locations list helpers', () => {
  it('builds google maps url from latlong', () => {
    expect(mapsUrlFromLatLong('19.07,72.87')).toBe('https://www.google.com/maps?q=19.07,72.87');
    expect(mapsUrlFromLatLong('19.07 72.87')).toBe('https://www.google.com/maps?q=19.07,72.87');
    expect(mapsUrlFromLatLong('bad')).toBeNull();
    expect(mapsUrlFromLatLong(null)).toBeNull();
  });

  it('builds date + search where clause', () => {
    const where = buildUserLocationListWhere({
      startDate: '2026-08-01',
      endDate: '2026-08-24',
      search: 'Acme',
      page: 1,
      limit: 50,
    });
    expect(where.sql).toContain('l.added_on >=');
    expect(where.sql).toContain('ILIKE');
    expect(where.values).toHaveLength(3);
  });
});
