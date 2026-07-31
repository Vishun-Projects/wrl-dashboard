import { createHash } from 'crypto';
import { access, mkdir, readFile, writeFile, rename, unlink, rm } from 'fs/promises';
import path from 'path';
import type {
  ArcpClaimsAggregateRow,
  ArcpClaimsDetailRow,
  ArcpClaimsQueryOpts,
} from '../services/query';
import { resolveArcpDateFilterColumn } from '../services/query';

/** Bump when tally/detail SQL or cache shape changes — invalidates chunk files. */
export const ARCP_CHUNK_CACHE_VERSION = 'v1';

export const ARCP_CHUNK_CACHE_TTL_MS =
  Number(process.env.ARCP_CHUNK_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000;

export function arcpChunkCacheEnabled(): boolean {
  return process.env.ARCP_CHUNK_CACHE_ENABLED !== 'false';
}

const CACHE_DIR = resolveArcpChunkCacheDir();

function resolveArcpChunkCacheDir(): string {
  if (process.env.ARCP_CHUNK_CACHE_DIR?.trim()) {
    return process.env.ARCP_CHUNK_CACHE_DIR.trim();
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'arcp-claims', 'chunks');
  }
  return path.join(process.cwd(), '.cache', 'arcp-claims', 'chunks');
}

export type ArcpChunkCacheKind = 'agg' | 'detail';

export type ArcpChunkLoadMeta = {
  cachedChunks: number;
  fetchedChunks: number;
  totalChunks: number;
};

type ChunkCachePayload =
  | { kind: 'agg'; rows: ArcpClaimsAggregateRow[] }
  | { kind: 'detail'; rows: ArcpClaimsDetailRow[] };

type MemEntry = {
  payload: ChunkCachePayload;
  timestamp: number;
  source: 'memory' | 'disk';
};

const memCache = new Map<string, MemEntry>();
const chunkInflight = new Map<string, Promise<ChunkCachePayload>>();

function cacheFilePath(cacheKey: string): string {
  const hash = createHash('sha256').update(cacheKey).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

export function buildArcpChunkCacheKey(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  kind: ArcpChunkCacheKind
): string {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const security = (opts.isHod ?? false) ? 'hod' : (opts.assignedOffices ?? []).join('-');
  return [
    ARCP_CHUNK_CACHE_VERSION,
    kind,
    chunk.start,
    chunk.end,
    dateColumn,
    opts.branch || 'All',
    opts.franchisee || 'All',
    opts.callType || 'All',
    security,
  ].join('|');
}

type DiskEntry = {
  timestamp: number;
  kind: ArcpChunkCacheKind;
  rows: ArcpClaimsAggregateRow[] | ArcpClaimsDetailRow[];
};

/** Cheap existence check — used by job reconcile without parsing JSON. */
export async function arcpChunkCacheFileExists(cacheKey: string): Promise<boolean> {
  if (!arcpChunkCacheEnabled()) return false;
  try {
    await access(cacheFilePath(cacheKey));
    return true;
  } catch {
    return false;
  }
}

/** Read cached rows from disk only (for job merge / resume). */
export async function readArcpChunkRowsFromDisk(
  cacheKey: string,
  kind: ArcpChunkCacheKind
): Promise<ArcpClaimsAggregateRow[] | ArcpClaimsDetailRow[] | null> {
  const mem = memCache.get(cacheKey);
  if (mem && mem.payload.kind === kind) {
    return mem.payload.rows;
  }

  const disk = await readDiskChunk(cacheKey);
  if (!disk || disk.payload.kind !== kind) return null;
  memCache.set(cacheKey, disk);
  return disk.payload.rows;
}

async function readDiskChunk(cacheKey: string): Promise<MemEntry | null> {
  try {
    const raw = await readFile(cacheFilePath(cacheKey), 'utf8');
    const parsed = JSON.parse(raw) as DiskEntry;
    if (!parsed?.kind || !Array.isArray(parsed.rows)) return null;
    const payload: ChunkCachePayload =
      parsed.kind === 'detail'
        ? { kind: 'detail', rows: parsed.rows as ArcpClaimsDetailRow[] }
        : { kind: 'agg', rows: parsed.rows as ArcpClaimsAggregateRow[] };
    return {
      payload,
      timestamp: parsed.timestamp ?? 0,
      source: 'disk',
    };
  } catch {
    return null;
  }
}

export type ResolvedArcpChunkCache = MemEntry & { stale: boolean };

export async function resolveArcpChunkCache(
  cacheKey: string,
  kind: ArcpChunkCacheKind,
  opts?: { bypass?: boolean }
): Promise<ResolvedArcpChunkCache | null> {
  if (!arcpChunkCacheEnabled() || opts?.bypass) return null;

  const now = Date.now();
  const mem = memCache.get(cacheKey);
  if (mem && mem.payload.kind === kind) {
    const stale = now - mem.timestamp >= ARCP_CHUNK_CACHE_TTL_MS;
    return { ...mem, stale };
  }

  const disk = await readDiskChunk(cacheKey);
  if (!disk || disk.payload.kind !== kind) return null;

  memCache.set(cacheKey, disk);
  const stale = now - disk.timestamp >= ARCP_CHUNK_CACHE_TTL_MS;
  return { ...disk, stale };
}

export async function writeArcpChunkCache(
  cacheKey: string,
  kind: ArcpChunkCacheKind,
  rows: ArcpClaimsAggregateRow[] | ArcpClaimsDetailRow[]
): Promise<void> {
  if (!arcpChunkCacheEnabled()) return;

  const payload: ChunkCachePayload =
    kind === 'detail'
      ? { kind: 'detail', rows: rows as ArcpClaimsDetailRow[] }
      : { kind: 'agg', rows: rows as ArcpClaimsAggregateRow[] };

  const timestamp = Date.now();
  memCache.set(cacheKey, { payload, timestamp, source: 'memory' });

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const filePath = cacheFilePath(cacheKey);
    const tempPath = `${filePath}.tmp`;
    const diskPayload: DiskEntry = { timestamp, kind, rows };
    await writeFile(tempPath, JSON.stringify(diskPayload), 'utf8');
    try {
      await unlink(filePath);
    } catch {
      // first write
    }
    await rename(tempPath, filePath);
  } catch (err) {
    console.warn('[ARCP] chunk disk cache write skipped:', err);
  }
}

export function getOrRunChunkInflight<T extends ChunkCachePayload>(
  cacheKey: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = chunkInflight.get(cacheKey);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => {
    chunkInflight.delete(cacheKey);
  });
  chunkInflight.set(cacheKey, promise);
  return promise;
}

export function clearArcpChunkCaches(): void {
  memCache.clear();
  chunkInflight.clear();
}

export async function clearArcpChunkDiskCache(): Promise<void> {
  try {
    await rm(CACHE_DIR, { recursive: true, force: true });
  } catch {
    // absent
  }
}

export function emptyArcpChunkMeta(totalChunks: number): ArcpChunkLoadMeta {
  return { cachedChunks: 0, fetchedChunks: 0, totalChunks };
}

export function mergeArcpChunkMeta(parts: ArcpChunkLoadMeta[]): ArcpChunkLoadMeta {
  return parts.reduce(
    (acc, p) => ({
      cachedChunks: acc.cachedChunks + p.cachedChunks,
      fetchedChunks: acc.fetchedChunks + p.fetchedChunks,
      totalChunks: acc.totalChunks + p.totalChunks,
    }),
    emptyArcpChunkMeta(0)
  );
}
