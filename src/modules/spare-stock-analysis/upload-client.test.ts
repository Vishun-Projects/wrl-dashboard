import { describe, expect, it } from 'vitest';
import {
  SPARE_STOCK_CHUNK_BYTES,
  spareStockChunkRanges,
} from '@/modules/spare-stock-analysis/upload-client';

describe('spareStockChunkRanges', () => {
  it('keeps each part under the Vercel same-origin body cap', () => {
    const size = 7 * 1024 * 1024;
    const ranges = spareStockChunkRanges(size);
    expect(ranges.length).toBe(3);
    expect(ranges.every((r) => r.end - r.start <= SPARE_STOCK_CHUNK_BYTES)).toBe(true);
    expect(ranges[0]).toEqual({ start: 0, end: SPARE_STOCK_CHUNK_BYTES });
    expect(ranges.at(-1)?.end).toBe(size);
  });
});
