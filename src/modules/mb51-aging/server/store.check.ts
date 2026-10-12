import assert from 'node:assert/strict';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

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
