import type { Mb51AgingImportMeta, Mb51AgingMovement } from '@/modules/mb51-aging/types';

/** Keep each POST under typical proxy body limits (JSON rows are fat). */
export const MB51_SAVE_CHUNK = 1200;

export type Mb51SaveBatch = {
  fileName: string;
  rows: Mb51AgingMovement[];
  replaceExisting: boolean;
  importId: string | null;
  seqOffset: number;
  expectedTotal: number;
};

/** Pure batch plan — first chunk replaces, later chunks append. */
export function planMb51SaveBatches(
  fileName: string,
  rows: Mb51AgingMovement[],
  chunkSize = MB51_SAVE_CHUNK
): Mb51SaveBatch[] {
  if (!rows.length) return [];
  const batches: Mb51SaveBatch[] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    batches.push({
      fileName,
      rows: rows.slice(offset, offset + chunkSize),
      replaceExisting: offset === 0,
      importId: null, // filled by caller after first response
      seqOffset: offset,
      expectedTotal: rows.length,
    });
  }
  return batches;
}

type SaveResponse = {
  success?: boolean;
  import?: Mb51AgingImportMeta;
  error?: string;
};

/**
 * Persist parsed MB51 rows in batches. First batch replaces prior imports;
 * later batches append to the same import_id.
 */
export async function saveMb51AgingRows(
  fileName: string,
  rows: Mb51AgingMovement[],
  onProgress?: (saved: number, total: number) => void
): Promise<Mb51AgingImportMeta> {
  if (!rows.length) throw new Error('No rows to save');

  const plan = planMb51SaveBatches(fileName, rows);
  let importId: string | null = null;
  let latest: Mb51AgingImportMeta | null = null;

  for (const batch of plan) {
    onProgress?.(batch.seqOffset, rows.length);

    const res = await fetch('/api/report/mb51-aging', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...batch,
        importId,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as SaveResponse;
    if (!res.ok || !data.import?.id) {
      throw new Error(
        data.error || `Save failed (${res.status}) at row ${batch.seqOffset + 1}`
      );
    }

    importId = data.import.id;
    latest = data.import;
    onProgress?.(Math.min(batch.seqOffset + batch.rows.length, rows.length), rows.length);
  }

  if (!latest) throw new Error('Save failed: no import metadata returned');
  return latest;
}
