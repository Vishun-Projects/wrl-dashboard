import { isCrmOutOfMemoryError, postQuery } from '@/lib/db-proxy';
import {
  arcpDateSpanDays,
  buildArcpClaimsDetailSql,
  buildArcpClaimsRawSql,
  mergeArcpAggregateRows,
  parseArcpAggregateRows,
  parseArcpDetailRows,
  planArcpSummaryDateChunks,
  splitArcpDateRange,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
} from '@/lib/arcp-claims-query';

export function isCrmSqlTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Timeout expired') ||
    message.includes('timeout period elapsed') ||
    message.includes('ETIMEDOUT')
  );
}

async function fetchArcpAggregateChunk(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  const res = await postQuery({
    rawSql: buildArcpClaimsRawSql({
      ...opts,
      startDate: chunk.start,
      endDate: chunk.end,
    }),
    timeoutMs,
  });
  return parseArcpAggregateRows((res.data || []) as Record<string, unknown>[]);
}

/** On CRM timeout, automatically split the window into smaller slices and retry. */
async function fetchArcpAggregateChunkResilient(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  try {
    return await fetchArcpAggregateChunk(opts, chunk, timeoutMs);
  } catch (err) {
    if (!isCrmSqlTimeoutError(err)) throw err;

    const span = arcpDateSpanDays(chunk.start, chunk.end);
    if (span == null || span <= 1) {
      throw new Error(
        `CRM timed out loading ARCP tally for ${chunk.start} to ${chunk.end}. Add a branch or franchisee filter, or retry.`
      );
    }

    const nextStep = span > 7 ? 3 : 1;
    const subChunks = splitArcpDateRange(chunk.start, chunk.end, nextStep);
    if (subChunks.length <= 1) throw err;

    console.log(
      `[ARCP Claims] timeout on ${chunk.start}..${chunk.end} — retrying as ${subChunks.length} smaller windows`
    );

    const merged: ArcpClaimsAggregateRow[] = [];
    for (const sub of subChunks) {
      merged.push(...(await fetchArcpAggregateChunkResilient(opts, sub, timeoutMs)));
    }
    return mergeArcpAggregateRows(merged);
  }
}

async function fetchArcpDetailChunk(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const res = await postQuery({
    rawSql: buildArcpClaimsDetailSql({
      ...opts,
      startDate: chunk.start,
      endDate: chunk.end,
    }),
    timeoutMs,
  });
  return parseArcpDetailRows((res.data || []) as Record<string, unknown>[]);
}

async function fetchArcpDetailChunkResilient(
  opts: ArcpClaimsQueryOpts,
  chunk: { start: string; end: string },
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  try {
    return await fetchArcpDetailChunk(opts, chunk, timeoutMs);
  } catch (err) {
    if (!isCrmSqlTimeoutError(err)) throw err;

    const span = arcpDateSpanDays(chunk.start, chunk.end);
    if (span == null || span <= 3) throw err;

    const nextStep = span > 14 ? 7 : span > 7 ? 3 : 1;
    const subChunks = splitArcpDateRange(chunk.start, chunk.end, nextStep);
    if (subChunks.length <= 1) throw err;

    const byUcn = new Map<string, ArcpClaimsDetailRow>();
    for (const sub of subChunks) {
      for (const row of await fetchArcpDetailChunkResilient(opts, sub, timeoutMs)) {
        const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
        if (!byUcn.has(key)) byUcn.set(key, row);
      }
    }
    return Array.from(byUcn.values());
  }
}

export async function fetchArcpClaimsAggregates(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpClaimsAggregateRow[]> {
  const chunks = planArcpSummaryDateChunks(opts);
  const merged: ArcpClaimsAggregateRow[] = [];

  for (const chunk of chunks) {
    merged.push(...(await fetchArcpAggregateChunkResilient(opts, chunk, timeoutMs)));
  }

  return chunks.length <= 1 ? merged : mergeArcpAggregateRows(merged);
}

export async function fetchArcpClaimsDetailRows(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
): Promise<ArcpClaimsDetailRow[]> {
  const chunks = planArcpSummaryDateChunks(opts);
  const byUcn = new Map<string, ArcpClaimsDetailRow>();

  for (const chunk of chunks) {
    for (const row of await fetchArcpDetailChunkResilient(opts, chunk, timeoutMs)) {
      const key = row.vucnno || `${row.calls2fault_code}:${row.franchisee_code}`;
      if (!byUcn.has(key)) byUcn.set(key, row);
    }
  }

  return Array.from(byUcn.values());
}

export { isCrmOutOfMemoryError };
