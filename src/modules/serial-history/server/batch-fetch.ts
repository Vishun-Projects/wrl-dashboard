import { postQuery } from '@/lib/db/proxy';
import { enrichCallRowForReport } from '@/modules/mis';
import {
  buildSerialAuditBatchDetailRawSql,
  MAX_SERIAL_AUDIT_BATCH_SERIALS,
  MAX_SERIAL_AUDIT_INVOLVEMENT_BATCH_SERIALS,
  type SerialAuditSqlOpts,
} from '@/sql/trhcalls/query';

/** Cap flagged serials loaded for ASP involvement (large windows can have hundreds). */
export const MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS = 150;

const DEFAULT_QUERY_TIMEOUT_MS = 300000;

function mapDetailRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) => enrichCallRowForReport(row));
}

export type FetchSerialAuditCallsOpts = SerialAuditSqlOpts & {
  /** Lighter repair_done SQL + smaller IN batches — for involvement analysis only. */
  involvementRepairs?: boolean;
  queryTimeoutMs?: number;
};

function chunkSerials(serials: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < serials.length; i += chunkSize) {
    chunks.push(serials.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Fetch window call rows for many serials — batches run sequentially to avoid CRM timeouts. */
export async function fetchSerialAuditCallsForSerials(
  serials: string[],
  opts: FetchSerialAuditCallsOpts = {}
): Promise<Record<string, unknown>[]> {
  const uniqueSerials = [
    ...new Set(serials.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (uniqueSerials.length === 0) return [];

  const involvement = opts.involvementRepairs === true;
  const chunkSize = involvement
    ? MAX_SERIAL_AUDIT_INVOLVEMENT_BATCH_SERIALS
    : MAX_SERIAL_AUDIT_BATCH_SERIALS;
  const timeoutMs = opts.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const { involvementRepairs, queryTimeoutMs, ...sqlOpts } = opts;
  void involvementRepairs;
  void queryTimeoutMs;

  const chunks = chunkSerials(uniqueSerials, chunkSize);
  const merged: Record<string, unknown>[] = [];

  for (const chunk of chunks) {
    const res = await postQuery({
      rawSql: buildSerialAuditBatchDetailRawSql(chunk, sqlOpts, involvement),
      timeoutMs,
    });
    merged.push(...mapDetailRows((res.data || []) as Record<string, unknown>[]));
  }

  return merged;
}

export function flaggedSerialsFromListRows(
  rows: Record<string, unknown>[],
  riskThreshold: number,
  maxSerials = MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS
): string[] {
  const flagged = rows
    .filter((row) => Number(row.complaint_count) >= riskThreshold)
    .map((row) => ({
      serial: String(row.serial ?? '').trim().toUpperCase(),
      count: Number(row.complaint_count) || 0,
    }))
    .filter((row) => row.serial);

  flagged.sort((a, b) => b.count - a.count);
  return flagged.slice(0, maxSerials).map((row) => row.serial);
}
