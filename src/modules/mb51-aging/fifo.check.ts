import assert from 'node:assert/strict';
import { BUCKETS, bucketOf, computeFifoAging } from '@/modules/mb51-aging/fifo';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

function row(partial: Partial<Mb51AgingMovement> & Pick<Mb51AgingMovement, 'd' | 'q' | 's'>): Mb51AgingMovement {
  return {
    m: 'MAT-1',
    md: 'Widget',
    g: 'G1',
    u: 'EA',
    v: 'V1',
    vn: 'Vendor',
    mv: '1152',
    ...partial,
  };
}

// Receipt 10 @ day 100, issue -4 @ day 130 → bal 6 on basis 150, allocated to receipt
const sample: Mb51AgingMovement[] = [
  row({ d: 100, q: 10, s: 0 }),
  row({ d: 130, q: -4, s: 1 }),
];

const res = computeFifoAging({
  rows: sample,
  basis: 150,
  from: 0,
  to: 200,
  groupBy: 'mat',
  selectedPlants: new Set(),
  selectedVendors: new Set(),
  selectedGroups: new Set(),
  selectedMaterials: new Set(),
  maxD: 130,
});

assert.ok(res);
assert.equal(res.stockMat, 1);
assert.equal(res.rows[0].total, 6);
assert.equal(res.rows[0].full, 6);
assert.equal(res.tot.reduce((s, v) => s + v, 0), 6);

// Posting-date from cuts opening receipt out of balance window
const ranged = computeFifoAging({
  rows: sample,
  basis: 150,
  from: 120,
  to: 200,
  groupBy: 'mat',
  selectedPlants: new Set(),
  selectedVendors: new Set(),
  selectedGroups: new Set(),
  selectedMaterials: new Set(),
  maxD: 130,
});
assert.ok(ranged);
// only issue -4 in range → negative / excluded from aging stock
assert.equal(ranged.stockMat, 0);
assert.equal(ranged.negMat, 1);

assert.equal(BUCKETS[3].l, '180 to 365 days');
assert.equal(BUCKETS[3].max, 365);
assert.equal(bucketOf(365), 3);
assert.equal(bucketOf(366), 4);

console.log('mb51-aging fifo check: ok');
