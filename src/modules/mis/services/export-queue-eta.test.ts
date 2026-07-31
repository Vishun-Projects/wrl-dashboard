import { describe, expect, it } from 'vitest';
import { estimateExportEtaSeconds } from '@/modules/mis/services/export-queue';

describe('estimateExportEtaSeconds', () => {
  it('hides absurd early ETA (1 row after TTFB)', () => {
    expect(
      estimateExportEtaSeconds({ fetched: 1, total: 187_088, elapsedSec: 2.7 })
    ).toBeUndefined();
  });

  it('returns a sane ETA once enough rows have streamed', () => {
    const eta = estimateExportEtaSeconds({
      fetched: 37_541,
      total: 187_088,
      elapsedSec: 90,
    });
    expect(eta).toBeTypeOf('number');
    expect(eta!).toBeGreaterThan(60);
    expect(eta!).toBeLessThan(60 * 60);
  });
});
