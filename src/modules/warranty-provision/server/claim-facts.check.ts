import assert from 'node:assert/strict';
import { claimTotalCost } from '@/modules/warranty-provision/server/claim-facts';

assert.equal(
  claimTotalCost({
    repairCost: 100,
    travelingReimbursement: 50,
    sparePartsCost: 25,
  }),
  175
);
assert.equal(
  claimTotalCost({
    repairCost: null,
    travelingReimbursement: 10,
    sparePartsCost: null,
  }),
  10
);
assert.equal(
  claimTotalCost({
    repairCost: 0,
    travelingReimbursement: 0,
    sparePartsCost: 0,
  }),
  0
);

console.log('claim-facts.check: ok');
