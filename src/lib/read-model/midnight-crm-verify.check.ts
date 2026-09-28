import assert from 'node:assert/strict';
import { isMidnightCrmVerifyOk } from '@/lib/read-model/midnight-crm-verify';

assert.equal(
  isMidnightCrmVerifyOk({ totalsMatch: true, monthGaps: 0, sampleMismatches: 0 }),
  true,
  'last night: 8 status deltas must not fail when totals/months/sample match'
);
assert.equal(
  isMidnightCrmVerifyOk({ totalsMatch: false, monthGaps: 0, sampleMismatches: 0 }),
  false
);
assert.equal(
  isMidnightCrmVerifyOk({ totalsMatch: true, monthGaps: 1, sampleMismatches: 0 }),
  false
);
assert.equal(
  isMidnightCrmVerifyOk({ totalsMatch: true, monthGaps: 0, sampleMismatches: 1 }),
  false
);
console.log('midnight-crm-verify ok');
