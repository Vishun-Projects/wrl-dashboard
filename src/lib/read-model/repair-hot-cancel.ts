import type pg from 'pg';
import { isRealCancelReasonCode } from '@/lib/report/search';

/** Fix hot rows where ncancelreason indicates cancel but status_bucket is still open/assigned. */
export async function repairHotCancelFromNcrReason(
  client: pg.PoolClient
): Promise<number> {
  const result = await client.query(
    `
    UPDATE calls_latest_hot
    SET status_bucket = 'cancelled',
        status_label = 'Cancelled',
        bsolved = false,
        bfastclose = false
    WHERE status_bucket IN ('assigned', 'open_unallocated')
      AND coalesce(ncancelreason, 0) NOT IN (0, 2)
    `
  );
  return result.rowCount ?? 0;
}

export function hotRowCancelReasonMismatch(row: {
  status_bucket?: string | null;
  ncancelreason?: number | null;
}): boolean {
  if (!isRealCancelReasonCode(row.ncancelreason)) return false;
  return row.status_bucket === 'assigned' || row.status_bucket === 'open_unallocated';
}
