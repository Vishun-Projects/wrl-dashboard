/** sessionStorage resume state + skip-set helpers for chunked MIS uploads. */

export const MIS_UPLOAD_RESUME_STORAGE_KEY = 'mis-client-upload-resume-v1';

export type MisUploadResumeState = {
  uploadId: string;
  fingerprint: string;
  chunkTotal: number;
  completed: number[];
  contentEncoding: 'gzip' | null;
  originalFileName: string;
  transferSize: number;
};

export function misUploadFingerprint(params: {
  fileName: string;
  fileSize: number;
  lastModified: number;
  sourceCode: string;
}): string {
  return [
    params.fileName,
    params.fileSize,
    params.lastModified,
    params.sourceCode.trim().toLowerCase(),
  ].join('|');
}

export function loadMisUploadResumeState(fingerprint: string): MisUploadResumeState | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MIS_UPLOAD_RESUME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MisUploadResumeState;
    if (!parsed || parsed.fingerprint !== fingerprint || !parsed.uploadId) return null;
    if (!Array.isArray(parsed.completed) || !Number.isFinite(parsed.chunkTotal)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMisUploadResumeState(state: MisUploadResumeState): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(MIS_UPLOAD_RESUME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / private mode — resume just won't work
  }
}

export function clearMisUploadResumeState(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(MIS_UPLOAD_RESUME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Indexes still needed after merging local + server received lists. */
export function missingMisUploadChunkIndexes(
  chunkTotal: number,
  ...receivedLists: number[][]
): number[] {
  const have = new Set<number>();
  for (const list of receivedLists) {
    for (const idx of list) {
      if (Number.isInteger(idx) && idx >= 0 && idx < chunkTotal) have.add(idx);
    }
  }
  const missing: number[] = [];
  for (let i = 0; i < chunkTotal; i++) {
    if (!have.has(i)) missing.push(i);
  }
  return missing;
}
