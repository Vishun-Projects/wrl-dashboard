/** Client-safe chunk upload settings (no server imports). */
export const MIS_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

export function shouldUseChunkedMisUpload(fileSize: number): boolean {
  const external = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim();
  if (external?.includes('api.wrl-fsm.cloud') || external?.includes('127.0.0.1')) {
    return true;
  }
  if (typeof window !== 'undefined' && /vercel\.app$/i.test(window.location.hostname)) {
    return fileSize > 3.5 * 1024 * 1024 || Boolean(external);
  }
  return false;
}
