/**
 * Compact binary pack for Mondelez/Cadbury pipe-CSV imports.
 * Layout: magic "WRLMIS1" (7 bytes) + gzip(msgpack payload).
 */
import { gunzipSync, gzipSync } from 'zlib';
import { decode, encode } from '@msgpack/msgpack';
import { decodeCsvBuffer, parsePipeDelimitedCsv } from '@/lib/mis-client-import/parse-csv';

export const WRLMIS_MAGIC = Buffer.from('WRLMIS1', 'ascii');
export const WRLMIS_EXTENSION = '.wrlmis';

export type WrlmisSourceHint = 'cadbury' | 'coke' | 'unknown';

export type WrlmisPayload = {
  sourceHint: WrlmisSourceHint;
  fileName: string;
  packedAt: string;
  headers: string[];
  /** Parallel to headers — already split pipe fields (UTF-8). */
  rows: string[][];
};

export type WrlmisUnpackResult = {
  headers: string[];
  rows: Record<string, string>[];
  sourceHint: WrlmisSourceHint;
  fileName: string;
  packedAt: string;
};

export function isWrlmisBuffer(buffer: Buffer): boolean {
  if (buffer.length < WRLMIS_MAGIC.length) return false;
  return buffer.subarray(0, WRLMIS_MAGIC.length).equals(WRLMIS_MAGIC);
}

export function isWrlmisFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(WRLMIS_EXTENSION);
}

function sniffHintFromHeaders(headers: string[]): WrlmisSourceHint {
  const normalized = headers.map((h) => h.toLowerCase());
  const has = (pattern: RegExp) => normalized.some((h) => pattern.test(h));
  if (has(/^call\s*no\.?$/) && (has(/^entity\s*name$/) || has(/^call\s*log\s*date$/))) {
    return 'coke';
  }
  if (
    has(/^\.?ticket\s*number$/) &&
    (has(/^v\s*date$/) || has(/^call\s*status$/) || has(/^branch\s*name$/))
  ) {
    return 'cadbury';
  }
  return 'unknown';
}

function recordsToMatrix(
  headers: string[],
  rows: Record<string, string>[]
): string[][] {
  return rows.map((row) => headers.map((h) => row[h] ?? ''));
}

function matrixToRecords(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((values) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? '';
    }
    return row;
  });
}

export function packWrlmisPayload(payload: WrlmisPayload): Buffer {
  const encoded = encode(payload);
  const compressed = gzipSync(Buffer.from(encoded), { level: 6 });
  return Buffer.concat([WRLMIS_MAGIC, compressed]);
}

export function unpackWrlmisBuffer(buffer: Buffer): WrlmisUnpackResult {
  if (!isWrlmisBuffer(buffer)) {
    throw new Error('Not a WRLMIS1 pack file');
  }
  const compressed = buffer.subarray(WRLMIS_MAGIC.length);
  const decoded = decode(gunzipSync(compressed)) as WrlmisPayload;
  if (!decoded || !Array.isArray(decoded.headers) || !Array.isArray(decoded.rows)) {
    throw new Error('Invalid WRLMIS1 payload');
  }
  const headers = decoded.headers.map((h) => String(h ?? ''));
  const matrix = decoded.rows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? ''))
  );
  const hint =
    decoded.sourceHint === 'cadbury' || decoded.sourceHint === 'coke'
      ? decoded.sourceHint
      : sniffHintFromHeaders(headers);
  return {
    headers,
    rows: matrixToRecords(headers, matrix),
    sourceHint: hint,
    fileName: String(decoded.fileName ?? 'import.wrlmis'),
    packedAt: String(decoded.packedAt ?? ''),
  };
}

/** Pack a Cadbury/Mondelez pipe-CSV buffer into `.wrlmis`. */
export function packCsvBufferToWrlmis(
  csvBuffer: Buffer,
  fileName: string,
  delimiter = '|'
): {
  packed: Buffer;
  headers: string[];
  rowCount: number;
  sourceHint: WrlmisSourceHint;
} {
  const content = decodeCsvBuffer(csvBuffer);
  const parsed = parsePipeDelimitedCsv(content, delimiter);
  const sourceHint = sniffHintFromHeaders(parsed.headers);
  const packed = packWrlmisPayload({
    sourceHint,
    fileName,
    packedAt: new Date().toISOString(),
    headers: parsed.headers,
    rows: recordsToMatrix(parsed.headers, parsed.rows),
  });
  return {
    packed,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    sourceHint,
  };
}
