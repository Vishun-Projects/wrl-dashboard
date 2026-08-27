import assert from 'node:assert/strict';
import { filterCrmRowsThroughAsOf, incrementalAsOfEndMs } from './incremental';

const end = incrementalAsOfEndMs('2026-08-26');
assert.ok(end != null);
assert.equal(new Date(end!).toISOString(), '2026-08-26T18:29:59.999Z'); // 23:59:59.999 IST

const rows = [
  { ncode: '1', editedon: '2026-08-26T18:00:00+05:30' },
  { ncode: '2', editedon: '2026-08-27T00:00:00+05:30' },
  { ncode: '3', editedon: '2026-08-27T12:00:00+05:30' },
];
const capped = filterCrmRowsThroughAsOf(rows, '2026-08-26');
assert.ok(capped);
assert.equal(capped!.rows.length, 1);
assert.equal(capped!.dropped, 2);
assert.equal(String(capped!.rows[0].ncode), '1');

assert.equal(
  filterCrmRowsThroughAsOf(
    [{ ncode: 'x', editedon: '2026-08-27T12:39:24+05:30' }],
    '2026-08-26'
  )!.rows.length,
  0
);

console.log('incremental as-of cap ok');
