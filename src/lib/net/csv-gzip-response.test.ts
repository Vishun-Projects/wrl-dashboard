import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'zlib';
import {
  gzippedCsvPayload,
  responseForCsvStream,
} from '@/lib/net/csv-gzip-response';

describe('csv gzip response helpers', () => {
  it('gzips buffered CSV when Accept-Encoding includes gzip', () => {
    const csv = 'a,b\n1,2\n'.repeat(50);
    const { body, headers } = gzippedCsvPayload(csv, 't.csv', 'gzip, deflate');
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(body).toBeInstanceOf(Uint8Array);
    expect(gunzipSync(Buffer.from(body as Uint8Array)).toString('utf8')).toBe(csv);
  });

  it('leaves buffered CSV plain without gzip accept', () => {
    const { body, headers } = gzippedCsvPayload('a,b\n', 't.csv', null);
    expect(headers['Content-Encoding']).toBeUndefined();
    expect(body).toBe('a,b\n');
  });

  it('responseForCsvStream does not set Content-Encoding (avoids CompressionStream close races)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a,b\n'));
        controller.close();
      },
    });
    const res = responseForCsvStream(
      stream,
      { 'Content-Type': 'text/csv; charset=utf-8' },
      'gzip'
    );
    expect(res.headers.get('Content-Encoding')).toBeNull();
    expect(await res.text()).toBe('a,b\n');
  });
});
