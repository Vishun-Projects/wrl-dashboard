import { fetchWithRetry } from '@/lib/net/fetch-with-retry';
import { fetchMb51Meta } from '@/modules/mb51-aging/api-client';
import type { Mb51AgingImportMeta, Mb51AgingMovement } from '@/modules/mb51-aging/types';

/**
 * Larger chunks + parallel POSTs for multi‑lakh MB51 uploads.
 * Packed row arrays keep JSON under typical serverless body caps.
 * ~788k rows → ~32 chunks @ 25k; with concurrency 4 ≈ ~9 round-trips after the first.
 */
export const MB51_SAVE_CHUNK = 25_000;
/** Parallel append chunks once importId is known (last chunk always alone to finalize). */
export const MB51_SAVE_CONCURRENCY = 4;
/** GET page size — full dump of multi‑M rows was ~350MB JSON → API 500. */
export const MB51_LOAD_CHUNK = 40_000;

/** Wire order for packed rows (shorter than keyed objects). */
export const MB51_PACK_KEYS = [
  'd',
  'q',
  'm',
  'md',
  'g',
  'u',
  'v',
  'vn',
  'mv',
  'dc',
  'mt',
  'mtx',
  'tx',
] as const;

export type Mb51PackKey = (typeof MB51_PACK_KEYS)[number];

export function packMb51Rows(rows: Mb51AgingMovement[]): unknown[][] {
  return rows.map((r) =>
    MB51_PACK_KEYS.map((k) => {
      const v = r[k];
      return v == null ? '' : v;
    })
  );
}

export function unpackMb51Rows(packed: unknown): Mb51AgingMovement[] {
  if (!Array.isArray(packed) || !packed.length) return [];
  // Already objects (legacy clients)
  if (packed[0] && typeof packed[0] === 'object' && !Array.isArray(packed[0])) {
    return packed as Mb51AgingMovement[];
  }
  return (packed as unknown[][]).map((arr, i) => {
    const row: Mb51AgingMovement = {
      d: Number(arr[0]) || 0,
      q: Number(arr[1]) || 0,
      m: String(arr[2] ?? ''),
      md: String(arr[3] ?? ''),
      g: String(arr[4] ?? ''),
      u: String(arr[5] ?? ''),
      v: String(arr[6] ?? ''),
      vn: String(arr[7] ?? ''),
      mv: String(arr[8] ?? ''),
      s: i,
      dc: String(arr[9] ?? ''),
      mt: String(arr[10] ?? ''),
      mtx: String(arr[11] ?? ''),
      tx: String(arr[12] ?? ''),
    };
    return row;
  });
}

export type Mb51SaveBatch = {
  fileName: string;
  rows: Mb51AgingMovement[];
  /** Always false for UI uploads — never wipe prior imports. */
  replaceExisting: boolean;
  importId: string | null;
  seqOffset: number;
  /** Fingerprints with seq_order below this are treated as already in DB. */
  dedupeBeforeSeq: number;
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
      // Freeze at upload start so same-file dups in later chunks are not blocked.
      dedupeBeforeSeq: priorCount,
      expectedTotal,
    });
  }
  return batches;
}

/** Payload shape: metadata before rows so importId cannot be lost if body is truncated. */
export function buildMb51SaveBody(
  batch: Mb51SaveBatch,
  importId: string | null,
  opts?: { finalize?: boolean }
): Record<string, unknown> {
  return {
    fileName: batch.fileName,
    replaceExisting: batch.replaceExisting && !importId,
    importId: importId ?? batch.importId,
    seqOffset: batch.seqOffset,
    dedupeBeforeSeq: batch.dedupeBeforeSeq,
    expectedTotal: batch.expectedTotal,
    finalize: opts?.finalize === true,
    packed: true,
    rows: packMb51Rows(batch.rows),
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

async function postSaveBatch(
  batch: Mb51SaveBatch,
  importId: string | null,
  finalize: boolean
): Promise<Mb51AgingImportMeta> {
  const res = await fetchWithRetry('/api/report/mb51-aging', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMb51SaveBody(batch, importId, { finalize })),
    retries: 6,
    retryDelayMs: 1200,
  });

  const data = (await res.json().catch(() => ({}))) as SaveResponse;
  if (!res.ok || !data.import?.id) {
    throw new Error(
      data.error ||
        `Save failed (${res.status}) at row ${batch.seqOffset + 1}`
    );
  }
  return data.import;
}

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

  // Keep in-file duplicates; server skips only fingerprints already in DB.
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

  const plan = planMb51SaveBatches(fileName, rows, {
    priorImportId: priorId,
    priorRowCount: priorCount,
    replaceExisting: false,
  });
  let importId: string | null = priorId;
  let latest: Mb51AgingImportMeta | null = null;
  const newTotal = rows.length;

  const markProgress = (batch: Mb51SaveBatch) => {
    onProgress?.(
      Math.min(batch.seqOffset - priorCount + batch.rows.length, newTotal),
      newTotal
    );
  };

  let start = 0;
  // First chunk alone when creating a new import (need importId for the rest).
  if (!importId) {
    const first = plan[0];
    if (!first) throw new Error('Save failed: empty plan');
    onProgress?.(0, newTotal);
    const only = plan.length === 1;
    latest = await postSaveBatch(first, null, only);
    importId = latest.id;
    markProgress(first);
    start = 1;
  }

  const rest = plan.slice(start);
  if (rest.length) {
    const last = rest[rest.length - 1];
    const mid = rest.slice(0, -1);

    for (let i = 0; i < mid.length; i += MB51_SAVE_CONCURRENCY) {
      const wave = mid.slice(i, i + MB51_SAVE_CONCURRENCY);
      onProgress?.(wave[0].seqOffset - priorCount, newTotal);
      const results: Mb51AgingImportMeta[] = await Promise.all(
        wave.map((batch): Promise<Mb51AgingImportMeta> =>
          postSaveBatch(batch, importId, false)
        )
      );
      for (const meta of results) {
        if (meta.id !== importId) {
          throw new Error(
            `MB51 save created a new import mid-upload (${importId} → ${meta.id}); aborting`
          );
        }
        latest = meta;
      }
      markProgress(wave[wave.length - 1]);
    }

    onProgress?.(last.seqOffset - priorCount, newTotal);
    latest = await postSaveBatch(last, importId, true);
    if (latest.id !== importId) {
      throw new Error(
        `MB51 save created a new import mid-upload (${importId} → ${latest.id}); aborting`
      );
    }
    markProgress(last);
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
