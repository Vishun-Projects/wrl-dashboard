import assert from 'node:assert/strict';
import {
  filterMb51AgainstExisting,
  mb51MovementDedupeKey,
} from '@/modules/mb51-aging/dedupe';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

const twin: Mb51AgingMovement = {
  d: 45000,
  q: 2,
  m: 'M1',
  md: 'Motor',
  g: 'G',
  u: 'EA',
  v: 'V1',
  vn: 'Vendor',
  mv: '1140',
  s: 0,
  dc: 'DOC1',
  mt: '101',
  tx: 'call',
};
const twin2 = { ...twin, s: 1 };
const other = { ...twin, dc: 'DOC2', s: 2 };

// Same-file duplicates all kept when DB empty
const fresh = filterMb51AgainstExisting([twin, twin2, other], new Set());
assert.equal(fresh.rows.length, 3);
assert.equal(fresh.skipped, 0);

// Key already in DB → drop every copy from this file; keep novel keys (all copies)
const existing = new Set([mb51MovementDedupeKey(twin)]);
const filtered = filterMb51AgainstExisting([twin, twin2, other, { ...other, s: 3 }], existing);
assert.equal(filtered.rows.length, 2);
assert.equal(filtered.skipped, 2);
assert.ok(filtered.rows.every((r) => r.dc === 'DOC2'));

console.log('dedupe.check.ts: ok');
