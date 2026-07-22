import { describe, expect, it } from 'vitest';
import { gunzipSync, gzipSync } from 'zlib';
import {
  isGzipBuffer,
  isMisUploadCompressibleFileName,
} from '@/features/mis-import/lib/upload-gzip';
import { maybeGunzipMisUploadBuffer } from '@/features/mis-import/lib/upload-http';
import { missingMisUploadChunkIndexes } from '@/features/mis-import/lib/upload-resume';

describe('MIS upload gzip + resume helpers', () => {
  it('marks csv compressible and skips xlsx / wrlmis', () => {
    expect(isMisUploadCompressibleFileName('coke.csv')).toBe(true);
    expect(isMisUploadCompressibleFileName('pack.wrlmis')).toBe(false);
    expect(isMisUploadCompressibleFileName('book.xlsx')).toBe(false);
  });

  it('gunzips contentEncoding=gzip round-trip to original bytes', () => {
    const original = Buffer.from('a|b|c\n1|2|3\n'.repeat(200), 'utf8');
    const compressed = gzipSync(original);
    expect(isGzipBuffer(compressed)).toBe(true);
    const roundTrip = maybeGunzipMisUploadBuffer(compressed, 'gzip');
    expect(Buffer.compare(roundTrip, original)).toBe(0);
  });

  it('does not gunzip plain buffers without gzip magic', () => {
    const plain = Buffer.from('WRLMIS1-not-really');
    expect(Buffer.compare(maybeGunzipMisUploadBuffer(plain, null), plain)).toBe(0);
  });

  it('missingMisUploadChunkIndexes merges local + server received lists', () => {
    expect(missingMisUploadChunkIndexes(5, [0, 1], [1, 3])).toEqual([2, 4]);
    expect(missingMisUploadChunkIndexes(3, [0, 1, 2], [])).toEqual([]);
    expect(missingMisUploadChunkIndexes(4, [], [])).toEqual([0, 1, 2, 3]);
  });

  it('rejects bogus gzip encoding', () => {
    expect(() => maybeGunzipMisUploadBuffer(Buffer.from('not-gzip'), 'gzip')).toThrow(
      /could not be decompressed/i
    );
  });
});

describe('gzip wire savings sanity', () => {
  it('gzip shrinks repetitive pipe CSV', () => {
    const csv = Buffer.from('col1|col2|col3\n' + 'foo|bar|baz\n'.repeat(5000), 'utf8');
    const gz = gzipSync(csv);
    expect(gz.byteLength).toBeLessThan(csv.byteLength / 2);
    expect(Buffer.compare(gunzipSync(gz), csv)).toBe(0);
  });
});
