import assert from 'node:assert/strict';
import { computeFifoAging } from '@/modules/mb51-aging/fifo';
import { fifoFromStockGroups } from '@/modules/mb51-aging/server/fifo-from-db';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

const rows: Mb51AgingMovement[] = [
  {
    d: 45000,
    q: 10,
    m: 'MAT-001',
    md: 'Compressor Motor',
    g: 'COMP',
    u: 'EA',
    v: 'VEND-99',
    vn: 'Apex Spares',
    mv: '1140',
    s: 0,
  },
  {
    d: 45030,
    q: -4,
    m: 'MAT-001',
    md: 'Compressor Motor',
    g: 'COMP',
    u: 'EA',
    v: 'VEND-99',
    vn: 'Apex Spares',
    mv: '1140',
    s: 1,
  },
];

const classic = computeFifoAging({
  rows,
  basis: 45050,
  from: -1e9,
  to: 1e9,
  groupBy: 'vm',
  selectedPlants: new Set(),
  selectedVendors: new Set(),
  selectedGroups: new Set(),
  selectedMaterials: new Set(),
  maxD: 45030,
});
assert.ok(classic);

const streamed = fifoFromStockGroups([rows], {
  basis: 45050,
  from: -1e9,
  to: 1e9,
  groupBy: 'vm',
  maxD: 45030,
  excluded: new Set(),
  plants: new Set(),
  vendors: new Set(),
  groups: new Set(),
  materials: new Set(),
});

assert.equal(streamed.summary.stockMat, classic.stockMat);
assert.equal(streamed.summary.fullTot, classic.fullTot);
assert.deepEqual(streamed.summary.tot, classic.tot);
assert.equal(streamed.rows.length, classic.rows.length);
assert.equal(streamed.rows[0]?.total, classic.rows[0]?.total);

console.log('mb51-aging fifo-from-db check: ok');
