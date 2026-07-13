/** Client-safe chunk upload settings (no server imports). */
export const MIS_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

/** Soft ceiling for same-origin Vercel posts before chunking (under ~4.5 MB body cap). */
export const MIS_VERCEL_CHUNK_THRESHOLD_BYTES = 3.5 * 1024 * 1024;

/**
 * Prefer one direct POST when a VPS upload URL is configured (large bodies OK).
 * On Vercel without that URL, chunk files that would hit the serverless body limit.
 * Local / non-Vercel: never chunk.
 */
export function shouldUseChunkedMisUpload(fileSize: number): boolean {
  const external = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim();
  if (external) {
    return false;
  }
  if (typeof window !== 'undefined' && /vercel\.app$/i.test(window.location.hostname)) {
    return fileSize > MIS_VERCEL_CHUNK_THRESHOLD_BYTES;
  }
  return false;
}
