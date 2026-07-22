/** Client-safe chunk upload settings (no server imports). */

/** Per-chunk body size on Vercel same-origin (under ~4.5 MB platform cap). */
export const MIS_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

/** Larger chunks when posting to the VPS upload host. */
export const MIS_UPLOAD_CHUNK_BYTES_VPS = 8 * 1024 * 1024;

/** Server accepts up to VPS chunk size (covers both paths). */
export const MIS_UPLOAD_CHUNK_BYTES_MAX = MIS_UPLOAD_CHUNK_BYTES_VPS;

/** Chunk when transfer payload exceeds this (always — enables resume on flaky links). */
export const MIS_UPLOAD_CHUNK_THRESHOLD_BYTES = 4 * 1024 * 1024;

/** @deprecated Use MIS_UPLOAD_CHUNK_THRESHOLD_BYTES */
export const MIS_VERCEL_CHUNK_THRESHOLD_BYTES = MIS_UPLOAD_CHUNK_THRESHOLD_BYTES;

export const MIS_UPLOAD_CHUNK_CONCURRENCY = 3;
export const MIS_UPLOAD_CHUNK_RETRIES = 3;

export function resolveMisUploadChunkBytes(): number {
  if (process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim()) {
    return MIS_UPLOAD_CHUNK_BYTES_VPS;
  }
  return MIS_UPLOAD_CHUNK_BYTES;
}

/**
 * Chunk files above the threshold on every host (local / Vercel / VPS)
 * so mid-transfer failures can resume instead of restarting from 0%.
 */
export function shouldUseChunkedMisUpload(fileSize: number): boolean {
  return fileSize > MIS_UPLOAD_CHUNK_THRESHOLD_BYTES;
}

/** Derive chunk API URL from direct upload URL or same-origin. */
export function resolveMisUploadChunkUrl(): string {
  const external = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim();
  if (external) {
    return external.replace(/\/upload\/?$/, '/upload-chunk');
  }
  return '/api/mis-client-import/upload-chunk';
}
