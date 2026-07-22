import { gzipSync } from 'zlib';

/** Gzip a UTF-8 CSV string for Content-Encoding: gzip responses. */
export function gzipCsvBody(csv: string): Uint8Array {
  return gzipSync(Buffer.from(csv, 'utf8'), { level: 6 });
}

export function csvDownloadHeaders(params: {
  fileName: string;
  gzip: boolean;
  contentLength?: number;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${params.fileName.replace(/"/g, '')}"`,
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
    ...params.extra,
  };
  if (params.gzip) {
    headers['Content-Encoding'] = 'gzip';
  }
  if (params.contentLength != null) {
    headers['Content-Length'] = String(params.contentLength);
  }
  return headers;
}

export function clientAcceptsGzip(acceptEncoding: string | null | undefined): boolean {
  return (acceptEncoding ?? '').toLowerCase().includes('gzip');
}

/**
 * Wrap a long-lived CSV byte stream as a Response.
 *
 * Do not pipe through CompressionStream here: register exports push from
 * `start()` without pull/backpressure, and the transform closes the source
 * mid-loop ("Controller is already closed"). Buffered CSVs use gzippedCsvPayload.
 * Edge/proxy gzip may still apply to text/csv.
 */
export function responseForCsvStream(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string>,
  _acceptEncoding?: string | null
): Response {
  return new Response(stream, { headers: { ...headers, Vary: 'Accept-Encoding' } });
}

/** Buffer CSV string → optionally gzipped body + headers. */
export function gzippedCsvPayload(
  csv: string,
  fileName: string,
  acceptEncoding?: string | null,
  extraHeaders?: Record<string, string>
): { body: string | Uint8Array; headers: Record<string, string> } {
  if (!clientAcceptsGzip(acceptEncoding)) {
    return {
      body: csv,
      headers: csvDownloadHeaders({ fileName, gzip: false, extra: extraHeaders }),
    };
  }
  const body = gzipCsvBody(csv);
  return {
    body,
    headers: csvDownloadHeaders({
      fileName,
      gzip: true,
      contentLength: body.byteLength,
      extra: extraHeaders,
    }),
  };
}
