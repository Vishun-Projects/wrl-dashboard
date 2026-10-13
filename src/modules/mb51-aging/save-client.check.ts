import assert from 'node:assert/strict';
import { planMb51SaveBatches } from '@/modules/mb51-aging/save-client';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

function row(i: number): Mb51AgingMovement {
  return {
    d: 45000 + i,
    q: 1,
    m: `M${i}`,
    md: '',
    g: '',
    u: 'EA',
    v: '',
    vn: '',
    mv: '1140',
    s: i,
  };
}

const rows = Array.from({ length: 2501 }, (_, i) => row(i));
const batches = planMb51SaveBatches('x.xlsx', rows, 1200);

assert.equal(batches.length, 3);
assert.equal(batches[0].replaceExisting, true);
assert.equal(batches[1].replaceExisting, false);
assert.equal(batches[2].rows.length, 101);
assert.equal(batches[0].seqOffset, 0);
assert.equal(batches[1].seqOffset, 1200);
assert.equal(batches[2].seqOffset, 2400);
assert.equal(batches[0].expectedTotal, 2501);

console.log('mb51-aging save-client check: ok');
