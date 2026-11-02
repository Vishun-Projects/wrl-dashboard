import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import { fetchMb51Meta } from '@/modules/mb51-aging/api-client';
import { dedupeMb51Movements } from '@/modules/mb51-aging/dedupe';
import type { Mb51AgingImportMeta, Mb51AgingMovement } from '@/modules/mb51-aging/types';

/**
 * Fewer POSTs stay under API rate limits.
 * ~147k rows → ~19 chunks at 8k (was ~90 at 1.2k → 429).
 */
export const MB51_SAVE_CHUNK = 8000;
/** GET page size — full dump of multi‑M rows was ~350MB JSON → API 500. */
export const MB51_LOAD_CHUNK = 40_000;

export type Mb51SaveBatch = {
  fileName: string;
  rows: Mb51AgingMovement[];
  /** Always false for UI uploads — never wipe prior imports. */
  replaceExisting: boolean;
  importId: string | null;
  seqOffset: number;
  expectedTotal: number;
};

export type PlanMb51SaveOpts = {
  chunkSize?: number;
  /** Existing import to append into (keeps prior rows in that import). */
  priorImportId?: string | null;
  /** Row count already stored for that import (new chunks start here). */
  priorRowCount?: number;
  /** Opt-in wipe — UI must leave this false. */
  replaceExisting?: boolean;
};

/** Pure batch plan. Default creates a new import; never wipes unless replaceExisting is true. */
export function planMb51SaveBatches(
  fileName: string,
  rows: Mb51AgingMovement[],
  chunkSizeOrOpts: number | PlanMb51SaveOpts = MB51_SAVE_CHUNK
): Mb51SaveBatch[] {
  if (!rows.length) return [];
  const opts: PlanMb51SaveOpts =
    typeof chunkSizeOrOpts === 'number'
      ? { chunkSize: chunkSizeOrOpts }
      : chunkSizeOrOpts;
  const chunkSize = opts.chunkSize ?? MB51_SAVE_CHUNK;
  const priorCount = Math.max(0, opts.priorRowCount ?? 0);
  const priorId = opts.priorImportId?.trim() || null;
  const wipe = opts.replaceExisting === true && !priorId;
  const expectedTotal = priorCount + rows.length;

  const batches: Mb51SaveBatch[] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    batches.push({
      fileName,
      rows: rows.slice(offset, offset + chunkSize),
      replaceExisting: wipe && offset === 0,
      importId: priorId,
      seqOffset: priorCount + offset,
      expectedTotal,
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
    importId: importId ?? batch.importId,
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

export type SaveMb51Opts = {
  /** Append into this import (overall dataset). Ignored when forceNewImport is true. */
  appendToImportId?: string | null;
  /**
   * Rare escape hatch. Default grows the single overall import so FIFO is one snapshot.
   * true → create a separate import (not what the aging report wants).
   */
  forceNewImport?: boolean;
  onProgress?: (saved: number, total: number) => void;
};

/**
 * Persist parsed MB51 rows in batches.
 * Default: append into the existing overall import (one dataset → one FIFO snapshot).
 * Never wipes prior rows unless the server is called with replaceExisting.
 */
export async function saveMb51AgingRows(
  fileName: string,
  rows: Mb51AgingMovement[],
  onProgressOrOpts?: ((saved: number, total: number) => void) | SaveMb51Opts
): Promise<Mb51AgingImportMeta> {
  if (!rows.length) throw new Error('No rows to save');

  const opts: SaveMb51Opts =
    typeof onProgressOrOpts === 'function'
      ? { onProgress: onProgressOrOpts }
      : onProgressOrOpts ?? {};
  const onProgress = opts.onProgress;

  // Drop identical lines inside this upload before chunking.
  const { rows: uniqueRows } = dedupeMb51Movements(rows);
  if (!uniqueRows.length) throw new Error('No rows to save after removing duplicates');

  let priorCount = 0;
  let priorId: string | null = null;
  if (!opts.forceNewImport) {
    const preferred = opts.appendToImportId?.trim() || null;
    const { imports, latestImport } = await fetchMb51Meta(preferred);
    const target =
      (preferred && imports.find((i) => i.id === preferred)) ||
      latestImport ||
      imports[0] ||
      null;
    if (target) {
      priorId = target.id;
      priorCount = target.rowCount;
    }
  }

  const plan = planMb51SaveBatches(fileName, uniqueRows, {
    priorImportId: priorId,
    priorRowCount: priorCount,
    replaceExisting: false,
  });
  let importId: string | null = priorId;
  let latest: Mb51AgingImportMeta | null = null;
  const newTotal = uniqueRows.length;

  for (const batch of plan) {
    if (batch.seqOffset > priorCount && !importId) {
      throw new Error('MB51 save aborted: missing importId for append chunk');
    }
    onProgress?.(batch.seqOffset - priorCount, newTotal);

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
        data.error || `Save failed (${res.status}) at row ${batch.seqOffset - priorCount + 1}`
      );
    }

    if (importId && data.import.id !== importId) {
      throw new Error(
        `MB51 save created a new import mid-upload (${importId} → ${data.import.id}); aborting`
      );
    }

    importId = data.import.id;
    latest = data.import;
    onProgress?.(
      Math.min(batch.seqOffset - priorCount + batch.rows.length, newTotal),
      newTotal
    );
  }

  if (!latest) throw new Error('Save failed: no import metadata returned');
  // Server may skip lines already present on append → rowCount can be below prior+new.
  if (latest.rowCount < priorCount) {
    throw new Error(
      `MB51 save lost rows: had ${priorCount.toLocaleString('en-IN')}, now ${latest.rowCount.toLocaleString('en-IN')}`
    );
  }
  if (latest.rowCount > priorCount + uniqueRows.length) {
    throw new Error(
      `MB51 save row count too high: stored ${latest.rowCount.toLocaleString('en-IN')} (expected at most ${(priorCount + uniqueRows.length).toLocaleString('en-IN')})`
    );
  }
  return latest;
}

type LoadPage = {
  latestImport?: Mb51AgingImportMeta | null;
  rows?: Mb51AgingMovement[];
  nextAfter?: number;
  done?: boolean;
  error?: string;
};

/**
 * Load latest MB51 import in pages (afterSeq cursor).
 * Progress: (loaded, totalHint) — totalHint from meta.rowCount when known.
 */
export async function fetchMb51AgingRows(
  onProgress?: (loaded: number, totalHint: number | null) => void
): Promise<{ latestImport: Mb51AgingImportMeta | null; rows: Mb51AgingMovement[] }> {
  const rows: Mb51AgingMovement[] = [];
  let afterSeq = -1;
  let latestImport: Mb51AgingImportMeta | null = null;

  for (;;) {
    const res = await fetchWithRetry(
      `/api/report/mb51-aging?afterSeq=${afterSeq}&limit=${MB51_LOAD_CHUNK}`,
      { credentials: 'include', retries: 4, retryDelayMs: 1000 }
    );
    const data = (await res.json().catch(() => ({}))) as LoadPage;
    if (!res.ok) {
      throw new Error(data.error || `Failed to load data (${res.status})`);
    }

    if (data.latestImport) latestImport = data.latestImport;
    const chunk = Array.isArray(data.rows) ? data.rows : [];
    rows.push(...chunk);
    onProgress?.(rows.length, latestImport?.rowCount ?? null);

    if (data.done || chunk.length === 0) break;
    afterSeq = typeof data.nextAfter === 'number' ? data.nextAfter : afterSeq + chunk.length;
  }

  return { latestImport, rows };
}
