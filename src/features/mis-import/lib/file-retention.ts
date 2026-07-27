/** Client-safe: how long original upload files are kept after import. */
export const IMPORT_FILE_RETENTION_DAYS = 7;

export const IMPORT_FILE_UNAVAILABLE_LABEL = 'Unavailable';

/** @deprecated use IMPORT_FILE_UNAVAILABLE_LABEL */
export const IMPORT_FILE_DOWNLOAD_UNAVAILABLE_LABEL = IMPORT_FILE_UNAVAILABLE_LABEL;

export function importFileRetentionTooltip(days = IMPORT_FILE_RETENTION_DAYS): string {
  return `Kept for ${days} days only`;
}

export function isImportFilePastRetention(
  uploadedAt: string | Date | null | undefined,
  days = IMPORT_FILE_RETENTION_DAYS,
  nowMs = Date.now()
): boolean {
  if (uploadedAt == null) return true;
  const t = typeof uploadedAt === 'string' ? Date.parse(uploadedAt) : uploadedAt.getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= days * 86_400_000;
}

/** Download/delete only while file is retained and still inside the retention window. */
export function canManageImportFile(opts: {
  uploadedAt: string | Date | null | undefined;
  fileRetained?: boolean | null;
  storedFilePath?: string | null;
  days?: number;
  nowMs?: number;
}): boolean {
  if (isImportFilePastRetention(opts.uploadedAt, opts.days, opts.nowMs)) return false;
  if (opts.fileRetained === false) return false;
  if (opts.fileRetained === true) return true;
  return Boolean(opts.storedFilePath?.trim());
}
