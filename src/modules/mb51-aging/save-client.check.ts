import assert from 'node:assert/strict';
import {
  MB51_SAVE_CHUNK,
  buildMb51SaveBody,
  planMb51SaveBatches,
} from '@/modules/mb51-aging/save-client';
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

assert.ok(MB51_SAVE_CHUNK >= 5000, 'chunk must stay large enough to avoid API rate limits');

const rows = Array.from({ length: 2501 }, (_, i) => row(i));
const batches = planMb51SaveBatches('x.xlsx', rows, 1200);

assert.equal(batches.length, 3);
assert.equal(batches[0].replaceExisting, true);
assert.equal(batches[1].replaceExisting, false);
assert.equal(batches[2].rows.length, 101);

// importId + seqOffset appear before rows in the JSON body
const body = buildMb51SaveBody(batches[1], 'import-uuid-1');
const keys = Object.keys(body);
assert.ok(keys.indexOf('importId') < keys.indexOf('rows'), 'importId must precede rows');
assert.ok(keys.indexOf('seqOffset') < keys.indexOf('rows'), 'seqOffset must precede rows');
assert.equal(body.importId, 'import-uuid-1');
assert.equal(body.replaceExisting, false);
assert.equal(body.seqOffset, 1200);

const large = Array.from({ length: 147_045 }, (_, i) => row(i));
const largePlan = planMb51SaveBatches('big.xlsx', large);
assert.ok(largePlan.length <= 20, `expected ≤20 chunks, got ${largePlan.length}`);
assert.equal(largePlan[0].expectedTotal, 147_045);
assert.equal(largePlan.at(-1)?.seqOffset! + largePlan.at(-1)!.rows.length, 147_045);

console.log('mb51-aging save-client check: ok');
