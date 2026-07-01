/** Full-file exports (CDMS / VMS): each upload replaces the prior snapshot for counts. */
export const SNAPSHOT_IMPORT_SOURCE_CODES = ['coke', 'cadbury'] as const;

export type SnapshotImportSourceCode = (typeof SNAPSHOT_IMPORT_SOURCE_CODES)[number];

export function isSnapshotImportSource(code: string): code is SnapshotImportSourceCode {
  return (SNAPSHOT_IMPORT_SOURCE_CODES as readonly string[]).includes(code.toLowerCase());
}
