/**
 * Client/server helpers for gzipping compressible MIS uploads on the wire.
 * Skip xlsx/xls (already zip) and .wrlmis (already gzip+msgpack).
 */

export function isMisUploadCompressibleFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.wrlmis')) {
    return false;
  }
  return lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv');
}

export function isGzipBuffer(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/** Browser gzip via CompressionStream; returns original blob if unsupported. */
export async function gzipBlobForMisUpload(blob: Blob): Promise<{ blob: Blob; encoding: 'gzip' | null }> {
  if (typeof CompressionStream === 'undefined') {
    return { blob, encoding: null };
  }
  try {
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).blob();
    if (compressed.size <= 0 || compressed.size >= blob.size) {
      return { blob, encoding: null };
    }
    return { blob: compressed, encoding: 'gzip' };
  } catch {
    return { blob, encoding: null };
  }
}
