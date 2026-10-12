import assert from 'node:assert/strict';
import { saveMb51AgingImport, fetchLatestMb51AgingData } from './store';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

async function runCheck() {
  const sampleRows: Mb51AgingMovement[] = [
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

  const saved = await saveMb51AgingImport({
    fileName: 'test-check-mb51.xlsx',
    uploadedBy: null,
    rows: sampleRows,
    replaceExisting: true,
  });

  assert.ok(saved.id, 'Import ID should be generated');
  assert.equal(saved.rowCount, 2, 'Row count should be 2');
  assert.equal(saved.fileName, 'test-check-mb51.xlsx');

  const fetched = await fetchLatestMb51AgingData();
  assert.ok(fetched.latestImport, 'Latest import should exist');
  assert.equal(fetched.latestImport?.id, saved.id);
  assert.equal(fetched.rows.length, 2, 'Should fetch 2 rows');
  assert.equal(fetched.rows[0].m, 'MAT-001');
  assert.equal(fetched.rows[0].q, 10);
  assert.equal(fetched.rows[1].q, -4);

  console.log('mb51-aging store.check: ok');
}

runCheck().catch((err) => {
  console.error('mb51-aging store.check failed:', err);
  process.exit(1);
});
