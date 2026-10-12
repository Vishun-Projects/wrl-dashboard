import assert from 'node:assert/strict';
import type { Mb51AgingMovement, Mb51AgingBucket } from '@/modules/mb51-aging/types';

const BUCKETS: Mb51AgingBucket[] = [
  { k: 'b1', l: 'Below 30 days', min: 0, max: 29, c: '#2e9e6b' },
  { k: 'b2', l: '30 to 60 days', min: 30, max: 59, c: '#7cb342' },
  { k: 'b3', l: '60 to 180 days', min: 60, max: 179, c: '#f2b01e' },
  { k: 'b4', l: '180 to 365 days', min: 180, max: 364, c: '#f08a24' },
  { k: 'b5', l: '1 year to 2 years', min: 365, max: 729, c: '#e0592a' },
  { k: 'b6', l: '2 to 3 years', min: 730, max: 1094, c: '#c0392b' },
  { k: 'b7', l: 'More than 3 years', min: 1095, max: 1e9, c: '#8e1f2f' },
];

function computeFifoInMemory(movs: Mb51AgingMovement[], basis: number) {
  let bal = 0;
  for (const r of movs) {
    if (r.d > basis) break;
    bal += r.q;
  }
  let rem = bal;
  const lay: [Mb51AgingMovement, number][] = [];
  for (let i = movs.length - 1; i >= 0 && rem > 1e-6; i--) {
    const r = movs[i];
    if (r.d > basis || r.q <= 0) continue;
    const take = Math.min(r.q, rem);
    rem -= take;
    lay.push([r, take]);
  }
  return { bal, lay };
}

function runCheck() {
  const sampleRows: Mb51AgingMovement[] = [
    { d: 45000, q: 10, m: 'MAT-001', md: 'Compressor Motor', g: 'COMP', u: 'EA', v: 'VEND-99', vn: 'Apex Spares', mv: '1140', s: 0 },
    { d: 45030, q: -4, m: 'MAT-001', md: 'Compressor Motor', g: 'COMP', u: 'EA', v: 'VEND-99', vn: 'Apex Spares', mv: '1140', s: 1 },
  ];

  const res = computeFifoInMemory(sampleRows, 45050);
  assert.equal(res.bal, 6, 'Closing balance should be 6');
  assert.equal(res.lay.length, 1, 'Should allocate to 1 receipt layer');
  assert.equal(res.lay[0][1], 6, 'Layer quantity should be 6');

  console.log('mb51-aging pure calculation check: ok');
}

runCheck();
