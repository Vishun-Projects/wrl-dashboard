import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import type { Mb51AgingImportMeta, Mb51AgingMovement } from '@/modules/mb51-aging/types';

/**
 * Fewer POSTs stay under API rate limits.
 * ~147k rows → ~19 chunks at 8k (was ~90 at 1.2k → 429).
 */
export const MB51_SAVE_CHUNK = 8000;

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

/** Payload shape: metadata before rows so importId cannot be lost if body is truncated. */
export function buildMb51SaveBody(
  batch: Mb51SaveBatch,
  importId: string | null
): Record<string, unknown> {
  return {
    fileName: batch.fileName,
    replaceExisting: batch.replaceExisting && !importId,
    importId,
    seqOffset: batch.seqOffset,
    expectedTotal: batch.expectedTotal,
    rows: batch.rows,
  };
}

type SaveResponse = {
  success?: boolean;
  import?: Mb51AgingImportMeta;
  error?: string;
};

/**
 * Persist parsed MB51 rows in batches. First batch replaces prior imports;
 * later batches append to the same import_id. Retries 429/5xx.
 * Fails if final meta.rowCount !== rows.length.
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
    if (batch.seqOffset > 0 && !importId) {
      throw new Error('MB51 save aborted: missing importId for append chunk');
    }
    onProgress?.(batch.seqOffset, rows.length);

    const res = await fetchWithRetry('/api/report/mb51-aging', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMb51SaveBody(batch, importId)),
      retries: 6,
      retryDelayMs: 1500,
    });

    const data = (await res.json().catch(() => ({}))) as SaveResponse;
    if (!res.ok || !data.import?.id) {
      throw new Error(
        data.error || `Save failed (${res.status}) at row ${batch.seqOffset + 1}`
      );
    }

    // Every chunk must report the same import id after the first
    if (importId && data.import.id !== importId) {
      throw new Error(
        `MB51 save created a new import mid-upload (${importId} → ${data.import.id}); aborting`
      );
    }

    importId = data.import.id;
    latest = data.import;
    onProgress?.(Math.min(batch.seqOffset + batch.rows.length, rows.length), rows.length);
  }

  if (!latest) throw new Error('Save failed: no import metadata returned');
  if (latest.rowCount !== rows.length) {
    throw new Error(
      `MB51 save incomplete: stored ${latest.rowCount.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} rows`
    );
  }
  return latest;
}
