import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import { withClient } from '@/lib/read-model/db';
import { splitDateRangeByDays, todayLocalDate, daysAgoDate } from '@/lib/read-model/dates';
import { sleep } from '@/lib/utils/async';
import { ARCP_NCODE_SHARD_INITIAL, ARCP_NCODE_SHARD_MAX } from '@/modules/arcp-claims/server/sync/crm-fetch';
import { processArcpRows } from '@/modules/arcp-claims/server/sync/transform';
import { upsertArcpRows } from '@/modules/arcp-claims/server/sync/upsert';
import { invalidateArcpPostgresCoverageCache } from '@/modules/arcp-claims/server/sync/coverage-query';

const TIMEOUT_MS = Number(process.env.ARCP_SYNC_TIMEOUT_MS ?? 180000) || 180000;


const DEFAULT_RESCAN_DAYS = Number(process.env.ARCP_APPROVAL_RESCAN_DAYS ?? 90) || 90;
const FETCH_GAP_MS = Number(process.env.ARCP_FETCH_GAP_MS ?? 1200) || 1200;

export type ArcpApprovalRescanResult = {
  ok: boolean;
  reason?: string;
  rowsUpserted: number;
  chunksProcessed: number;
};

function appendRows(target: Record<string, unknown>[], source: Record<string, unknown>[]): void {
  for (let i = 0; i < source.length; i++) target.push(source[i]);
}

function isRetryable(err: unknown): boolean {
  if (isCrmOutOfMemoryError(err) || isCrmSqlTimeoutError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('ECONNRESET') || msg.includes('socket hang up');
}

/**
 * Fetch ARCP rows WHERE dbmapproveddate falls in [startDate, endDate].
 *
 * WHY THIS EXISTS: The CRM sets dbmapproveddate without touching editedon.
 * The incremental sync queries by editedon — so it never sees these approval changes.
 * The call date (dcalllogdatetime) can be months earlier than the approval date,
 * so rescanning by call-log date also misses them. We MUST filter by dbmapproveddate.
 */
async function fetchByApprovalDateShard(
  startDate: string,
  endDate: string,
  shardIndex: number,
  shardCount: number,
): Promise<Record<string, unknown>[]> {
  const endTs = `${endDate} 23:59:59`;
  const where = `arcp.nofficetype = '3' AND arcp.dbmapproveddate >= '${startDate}' AND arcp.dbmapproveddate <= '${endTs}' AND (arcp.ncode % ${shardCount}) = ${shardIndex}`;
  const rawSql = `
SELECT arcp.ncode, arcp.vucnno, arcp.ncalls2fault AS calls2fault_code,
  CAST(tf.ncalls AS VARCHAR(50)) AS call_no, arcp.nofficeid, o.nunder AS office_under,
  CONVERT(varchar(30), arcp.dcalllogdatetime, 126) AS dcalllogdatetime,
  CONVERT(varchar(30), arcp.dsolveddatetime, 126) AS dsolveddatetime,
  arcp.bapproved, arcp.bapprovedho, arcp.dbmapproveddate, arcp.dhoapproveddate,
  CONVERT(varchar(30), arcp.dapproval1on, 126) AS dapproval1on,
  CONVERT(varchar(30), arcp.dapproval2on, 126) AS dapproval2on,
  CONVERT(varchar(30), arcp.addedon, 126) AS addedon,
  CONVERT(varchar(30), arcp.editedon, 126) AS editedon,
  arcp.ncalltype, arcp.nitemcategory, arcp.nlocalupcountry, arcp.ntraveltype,
  arcp.breject, arcp.brejectho,
  ISNULL(NULLIF(LTRIM(RTRIM(fs_ct.vdisplayvalue)), ''), CAST(arcp.ncalltype AS VARCHAR(50))) AS call_type_label,
  COALESCE(NULLIF(LTRIM(RTRIM(ic.vname)), ''), NULLIF(LTRIM(RTRIM(ic.vshortname)), '')) AS item_category_label,
  COALESCE(NULLIF(LTRIM(RTRIM(fs_lu.vdisplayvalue)), ''),
    CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
      WHEN '1' THEN 'Local' WHEN '2' THEN 'Upcountry'
      WHEN '946' THEN 'Local' WHEN '947' THEN 'Upcountry'
      ELSE CAST(arcp.nlocalupcountry AS VARCHAR(50)) END) AS local_upcountry_label,
  arcp.ndistancerate, arcp.nchargespayable, arcp.nbmapprovedamt, arcp.nhoapprovedamt,
  arcp.napproval1amount, arcp.napproval2amount,
  CASE WHEN major.ncalls IS NOT NULL THEN 'Major' ELSE 'Minor' END AS major_minor
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
LEFT JOIN mstitemcategory ic (NOLOCK) ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
LEFT JOIN mstfixedselection fs_ct (NOLOCK)
  ON CAST(fs_ct.ncode AS VARCHAR(50)) = CAST(arcp.ncalltype AS VARCHAR(50)) AND fs_ct.vfieldname = 'ncalltype'
LEFT JOIN mstfixedselection fs_lu (NOLOCK)
  ON CAST(fs_lu.ncode AS VARCHAR(50)) = CAST(arcp.nlocalupcountry AS VARCHAR(50)) AND fs_lu.vfieldname = 'nlocalupcountry'
OUTER APPLY (
  SELECT TOP 1 tf2.ncalls FROM trdcalls2fault tf2 (NOLOCK)
  JOIN mstrepair rr (NOLOCK) ON tf2.nrepair = rr.ncode
  WHERE tf2.ncalls = tf.ncalls AND tf2.nofficeid = arcp.nofficeid AND rr.bmajor = 'True'
) major
WHERE ${where}`.trim();

  try {
    const result = await postQuery({ rawSql, timeoutMs: TIMEOUT_MS });
    return (result.data ?? []) as Record<string, unknown>[];
  } catch (err) {
    if (!isRetryable(err)) throw err;
    if (shardCount >= ARCP_NCODE_SHARD_MAX) throw err;
    const doubled = shardCount * 2;
    const left = await fetchByApprovalDateShard(startDate, endDate, shardIndex, doubled);
    const right = await fetchByApprovalDateShard(startDate, endDate, shardIndex + shardCount, doubled);
    const merged = new Array<Record<string, unknown>>(left.length + right.length);
    for (let i = 0; i < left.length; i++) merged[i] = left[i];
    for (let j = 0; j < right.length; j++) merged[left.length + j] = right[j];
    return merged;
  }
}

async function fetchByApprovalDate(startDate: string, endDate: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  // Always shard — approval-date queries touch the full table cross-month, OOM without sharding.
  for (let i = 0; i < ARCP_NCODE_SHARD_INITIAL; i++) {
    const rows = await fetchByApprovalDateShard(startDate, endDate, i, ARCP_NCODE_SHARD_INITIAL);
    appendRows(all, rows);
    await sleep(FETCH_GAP_MS);
  }
  return all;
}

/**
 * Re-fetch ARCP rows by dbmapproveddate for the last N days and upsert.
 *
 * This is the CORRECT fix for missing July BM approvals:
 *   - CRM sets dbmapproveddate in July on records with June/May call dates
 *   - editedon is never updated → incremental sync misses them
 *   - Rescanning by dcalllogdatetime (call-log date) also misses them
 *   - Only filtering by dbmapproveddate catches all of them
 *
 * Run: npx tsx src/lib/read-model/cli.ts arcp-approval-rescan --from 2026-07-01 --to 2026-07-31
 * Env: ARCP_APPROVAL_RESCAN_DAYS (default 90)
 */
export async function runArcpApprovalRescan(opts?: {
  fromDate?: string;
  toDate?: string;
  rescanDays?: number;
}): Promise<ArcpApprovalRescanResult> {
  const toDate = opts?.toDate ?? todayLocalDate();
  const days = opts?.rescanDays ?? DEFAULT_RESCAN_DAYS;
  const fromDate = opts?.fromDate ?? daysAgoDate(days);

  console.log(`[arcp-approval-rescan] Re-scanning approvals: dbmapproveddate ${fromDate} .. ${toDate}`);
  console.log('[arcp-approval-rescan] Using approval-date filter (not call-log date) to catch editedon-silent CRM updates.');

  // 1-day chunks to keep CRM memory usage bounded (approval-date scans touch all months)
  const chunks = splitDateRangeByDays(fromDate, toDate, 1);
  let totalUpserted = 0;
  let chunksProcessed = 0;

  try {
    for (const chunk of chunks) {
      console.log(`[arcp-approval-rescan] Fetching approval-date ${chunk.start} (${chunksProcessed + 1}/${chunks.length})`);
      const rows = await fetchByApprovalDate(chunk.start, chunk.end);
      const hotRows = processArcpRows(rows);

      if (hotRows.length > 0) {
        const withBm = hotRows.filter((r) => r.bm_approved_at != null).length;
        const n = await withClient((client) => upsertArcpRows(client, hotRows, 50));
        totalUpserted += n;
        console.log(`[arcp-approval-rescan] ${chunk.start} — ${rows.length} CRM rows → ${n} upserted (${withBm} with BM approve)`);
        if (n > 0) invalidateArcpPostgresCoverageCache();
      }
      chunksProcessed++;
    }

    console.log(`[arcp-approval-rescan] Done — ${totalUpserted} rows upserted across ${chunksProcessed} days`);
    return { ok: true, rowsUpserted: totalUpserted, chunksProcessed };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[arcp-approval-rescan] Failed:', reason);
    return { ok: false, reason, rowsUpserted: totalUpserted, chunksProcessed };
  }
}
