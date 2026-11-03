import assert from 'node:assert/strict';
import {
  enrichMb51VendorNames,
  normVendorCode,
} from '@/modules/mb51-aging/server/vendor-master';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

assert.equal(normVendorCode(' 100001 '), '100001');

const base: Mb51AgingMovement = {
  d: 45000,
  q: 1,
  m: 'M1',
  md: '',
  g: '',
  u: 'EA',
  v: '100001',
  vn: '',
  mv: '1140',
  s: 0,
  dc: 'DOC1',
  mt: '101',
  mtx: '',
  tx: '',
};

const master = new Map([['100001', 'A S MARKETING']]);
const enriched = enrichMb51VendorNames([base, { ...base, v: '999999', vn: 'Keep Me' }], master);
assert.equal(enriched[0].vn, 'A S MARKETING');
assert.equal(enriched[1].vn, 'Keep Me');

const overwrite = enrichMb51VendorNames([{ ...base, vn: 'Old Name' }], master);
assert.equal(overwrite[0].vn, 'A S MARKETING');

console.log('mb51-aging vendor-master check: ok');
