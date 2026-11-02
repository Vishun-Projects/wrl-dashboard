import assert from 'node:assert/strict';
import { dedupeMb51Movements, mb51MovementDedupeKey } from '@/modules/mb51-aging/dedupe';
import {
  MB51_LOAD_CHUNK,
  MB51_SAVE_CHUNK,
  MB51_SAVE_CONCURRENCY,
  buildMb51SaveBody,
  packMb51Rows,
  planMb51SaveBatches,
  unpackMb51Rows,
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

assert.ok(MB51_SAVE_CHUNK >= 20_000, 'chunk must stay large for multi-lakh uploads');
assert.ok(MB51_SAVE_CONCURRENCY >= 3, 'parallel appends required for wall-clock speed');
assert.ok(MB51_LOAD_CHUNK >= 10_000 && MB51_LOAD_CHUNK <= 80_000, 'load page must stay under JSON size ceiling');

const rows = Array.from({ length: 2501 }, (_, i) => row(i));

// Default plan = new import, never wipe
const batches = planMb51SaveBatches('x.xlsx', rows, 1200);
assert.equal(batches.length, 3);
assert.equal(batches[0].replaceExisting, false, 'UI plan must never wipe');
assert.equal(batches[0].importId, null, 'default creates a new import');
assert.equal(batches[0].seqOffset, 0);
assert.equal(batches[2].rows.length, 101);

// Optional append onto prior import
const append = planMb51SaveBatches('part2.xlsx', rows, {
  chunkSize: 1200,
  priorImportId: 'prior-uuid',
  priorRowCount: 10_000,
});
assert.equal(append[0].importId, 'prior-uuid');
assert.equal(append[0].seqOffset, 10_000);
assert.equal(append[0].replaceExisting, false);
assert.equal(append[0].expectedTotal, 10_000 + 2501);

// Explicit wipe only when asked and no prior id
const wipe = planMb51SaveBatches('fresh.xlsx', rows.slice(0, 10), {
  replaceExisting: true,
  chunkSize: 5,
});
assert.equal(wipe[0].replaceExisting, true);
assert.equal(wipe[1].replaceExisting, false);

const body = buildMb51SaveBody(append[1], 'prior-uuid');
const keys = Object.keys(body);
assert.ok(keys.indexOf('importId') < keys.indexOf('rows'), 'importId must precede rows');
assert.equal(body.replaceExisting, false);
assert.equal(body.seqOffset, 10_000 + 1200);

const large = Array.from({ length: 147_045 }, (_, i) => row(i));
const largePlan = planMb51SaveBatches('big.xlsx', large);
assert.ok(largePlan.length <= 8, `expected ≤8 chunks @25k, got ${largePlan.length}`);
assert.equal(largePlan[0].expectedTotal, 147_045);

assert.equal(
  Math.ceil(788_770 / MB51_SAVE_CHUNK),
  32,
  '≈8 lakh rows should be ~32 chunks of 25k'
);

const packedBody = buildMb51SaveBody(largePlan[0], null, { finalize: false });
assert.equal(packedBody.packed, true);
assert.equal(packedBody.finalize, false);
assert.ok(Array.isArray(packedBody.rows));
assert.ok(Array.isArray((packedBody.rows as unknown[])[0]));
const roundTrip = unpackMb51Rows(packMb51Rows(largePlan[0].rows.slice(0, 3)));
assert.equal(roundTrip.length, 3);
assert.equal(roundTrip[0].m, largePlan[0].rows[0].m);
assert.equal(roundTrip[0].q, largePlan[0].rows[0].q);

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
const twin2 = { ...twin, s: 99, md: 'ignored for key', vn: 'also ignored' };
assert.equal(mb51MovementDedupeKey(twin), mb51MovementDedupeKey(twin2));
const deduped = dedupeMb51Movements([twin, twin2, { ...twin, dc: 'DOC2' }]);
assert.equal(deduped.rows.length, 2);
assert.equal(deduped.skipped, 1);

console.log('mb51-aging save-client check: ok');
