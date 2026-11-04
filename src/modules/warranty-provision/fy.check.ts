/**
 *   npx tsx src/modules/warranty-provision/fy.check.ts
 */
import assert from 'node:assert/strict';
import {
  asOfFromPeriodYm,
  coverageFraction,
  fyLabel,
  fySpanDays,
  fyStartYear,
  mfgYearFromSerial,
  monthStartIso,
  parsePeriodYm,
  remainingDays,
  warrantyEndIso,
  warrantyStatus,
} from './fy';

assert.equal(fyStartYear('2026-04-01'), 2026);
assert.equal(fyStartYear('2026-03-31'), 2025);
assert.equal(fyLabel(2025), '25-26');
assert.equal(fyLabel(2026), '26-27');
assert.equal(fySpanDays(2025), 364);

assert.equal(warrantyEndIso('2019-06-04', 2190), '2025-06-02');
assert.equal(remainingDays('2025-06-02', '2025-06-02'), 0);
assert.equal(warrantyStatus('2025-06-02', '2025-06-01'), 'Active');
assert.equal(warrantyStatus('2025-06-02', '2025-06-02'), 'Inactive');

const full = coverageFraction({
  asOf: '2024-04-01',
  fyStartYear: 2024,
  warrantyStart: '2020-01-01',
  warrantyEnd: '2030-01-01',
  days: 3650,
});
assert.ok(Math.abs(full - 1) < 1e-9, `expected ~1 got ${full}`);

assert.equal(
  coverageFraction({
    asOf: '2024-04-01',
    fyStartYear: 2024,
    warrantyStart: '2020-01-01',
    warrantyEnd: '2030-01-01',
    days: 0,
  }),
  0
);

const loose = coverageFraction({
  asOf: '2025-04-01',
  fyStartYear: 2025,
  warrantyStart: '2025-08-01',
  warrantyEnd: '2026-08-01',
  days: 365,
  strict: false,
});
const strict = coverageFraction({
  asOf: '2025-04-01',
  fyStartYear: 2025,
  warrantyStart: '2025-08-01',
  warrantyEnd: '2026-08-01',
  days: 365,
  strict: true,
});
assert.ok(strict < loose, `strict ${strict} should be < loose ${loose}`);

// Excel MID(serial,6,2)+2000 when LEN=14
assert.equal(mfgYearFromSerial('ABCDE24123456', '2020-01-01'), 2020); // len 13 → invoice year
assert.equal(mfgYearFromSerial('ABCDE241234567', '2020-01-01'), 2024); // len 14 → chars 6-7 = 24
assert.equal(mfgYearFromSerial('SHORT', 2019), 2019);
assert.equal(mfgYearFromSerial('SHORT', null), null);

assert.equal(parsePeriodYm('2026-10'), '2026-10');
assert.equal(parsePeriodYm('2026-10-15'), '2026-10');
assert.equal(monthStartIso('2026-10'), '2026-10-01');
assert.equal(asOfFromPeriodYm('2026-10'), '2026-11-01'); // EOM+1
assert.equal(asOfFromPeriodYm('2026-12'), '2027-01-01');

console.log('warranty-provision fy check: ok');
