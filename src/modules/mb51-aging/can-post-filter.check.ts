import assert from 'node:assert/strict';
import { canPostFilterMb51Agg } from '@/modules/mb51-aging/can-post-filter';
import type { Mb51AgingReportParams } from '@/modules/mb51-aging/types';

const base: Mb51AgingReportParams = {
  basis: 46000,
  from: 45000,
  to: 46000,
  groupBy: 'vm',
  plants: [],
  vendors: [],
  groups: [],
  materials: [],
  excludedMaterials: ['1301709'],
};

assert.equal(canPostFilterMb51Agg(base, { ...base, vendors: ['V1'] }), true);
assert.equal(canPostFilterMb51Agg(base, { ...base, materials: ['M1'] }), true);
assert.equal(canPostFilterMb51Agg(base, { ...base, groups: ['G1'] }), true);
assert.equal(canPostFilterMb51Agg(base, { ...base, plants: ['P1'] }), false);
assert.equal(canPostFilterMb51Agg(base, { ...base, basis: 46001 }), false);
assert.equal(canPostFilterMb51Agg(base, { ...base, groupBy: 'mat' }), false);
// excluding more is a post-filter
assert.equal(
  canPostFilterMb51Agg(base, { ...base, excludedMaterials: ['1301709', 'x'] }),
  true
);
// un-excluding needs rows the snap never computed
assert.equal(canPostFilterMb51Agg(base, { ...base, excludedMaterials: [] }), false);
assert.equal(
  canPostFilterMb51Agg(
    { ...base, excludedMaterials: [] },
    { ...base, excludedMaterials: ['1301709'] }
  ),
  true
);
assert.equal(
  canPostFilterMb51Agg(
    { ...base, groupBy: 'vendor' },
    { ...base, groupBy: 'vendor', materials: ['M1'] }
  ),
  false
);
assert.equal(
  canPostFilterMb51Agg(
    { ...base, groupBy: 'mat' },
    { ...base, groupBy: 'mat', groups: ['G1'], materials: ['M1'] }
  ),
  true
);

console.log('can-post-filter.check.ts: ok');
