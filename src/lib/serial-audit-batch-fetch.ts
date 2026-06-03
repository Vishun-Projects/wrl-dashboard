import { postQuery } from '@/lib/db-proxy';
import { enrichCallRowForReport } from '@/lib/report-geo';
import {
  buildSerialAuditBatchDetailRawSql,
  MAX_SERIAL_AUDIT_BATCH_SERIALS,
  type SerialAuditSqlOpts,
} from '@/lib/trhcalls-query';

function mapDetailRows(rawRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rawRows.map((row) => enrichCallRowForReport(row));
}

/** Fetch window call rows for many serials — batches run in parallel. */
export async function fetchSerialAuditCallsForSerials(
  serials: string[],
  opts: SerialAuditSqlOpts,
  queryTimeoutMs = 180000
): Promise<Record<string, unknown>[]> {
  const uniqueSerials = [
    ...new Set(serials.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (uniqueSerials.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueSerials.length; i += MAX_SERIAL_AUDIT_BATCH_SERIALS) {
    chunks.push(uniqueSerials.slice(i, i + MAX_SERIAL_AUDIT_BATCH_SERIALS));
  }

  const batchResults = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await postQuery({
        rawSql: buildSerialAuditBatchDetailRawSql(chunk, opts),
        timeoutMs: queryTimeoutMs,
      });
      return mapDetailRows((res.data || []) as Record<string, unknown>[]);
    })
  );

  return batchResults.flat();
}

export function flaggedSerialsFromListRows(
  rows: Record<string, unknown>[],
  riskThreshold: number
): string[] {
  return rows
    .filter((row) => Number(row.complaint_count) >= riskThreshold)
    .map((row) => String(row.serial ?? '').trim().toUpperCase())
    .filter(Boolean);
}
