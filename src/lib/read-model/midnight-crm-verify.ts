import { postQuery } from '@/lib/db/proxy';
import { withAppClient } from '@/lib/read-model/db';
import { runHotCrmMismatchSampleCheck } from '@/lib/read-model/check-hot-crm-mismatch';
import { buildTrhcallsBaseCondition } from '@/sql/trhcalls/query';

const YTD_START = () =>
  process.env.SYNC_EDITEDON_CATCHUP_FROM?.trim() ||
  `${new Date().getFullYear()}-01-01`;

function n(v: unknown): number {
  return Number(v ?? 0);
}

function crmDedupTable(from: string, to: string): string {
  const esc = (d: string) => d.replace(/'/g, "''");
  return `(
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
        ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
      ) rn FROM trhcalls (NOLOCK)
      WHERE dtrndate >= '${esc(from)}' AND dtrndate <= '${esc(to)} 23:59:59'
    ) s WHERE s.rn = 1
  ) tc`;
}

const NOT_CANCELLED = '(tc.ncancelreason IS NULL OR tc.ncancelreason = 0 OR tc.ncancelreason = 2)';
const SOLVED_FLAGS =
  "((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1))";

const CRM_SUMMARY = `
  COUNT(*) as total,
  SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled,
  SUM(CASE WHEN ${NOT_CANCELLED} AND ${SOLVED_FLAGS} THEN 1 ELSE 0 END) as solved,
  SUM(CASE WHEN NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls,
  SUM(CASE WHEN (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_unallocated,
  SUM(CASE WHEN (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as assigned,
  SUM(CASE WHEN (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND NOT (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as tech_solved,
  SUM(CASE WHEN (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as closed
`;

function monthRanges(asOf: string): [string, string][] {
  const year = asOf.slice(0, 4);
  const ranges: [string, string][] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const last = new Date(Number(year), m, 0).getDate();
    const from = `${year}-${mm}-01`;
    const to = m === Number(asOf.slice(5, 7)) ? asOf : `${year}-${mm}-${String(last).padStart(2, '0')}`;
    if (from > asOf) break;
    ranges.push([from, to]);
  }
  return ranges;
}

async function crmMonthCount(from: string, to: string): Promise<number> {
  const cond = buildTrhcallsBaseCondition({
    startDate: from,
    endDate: to,
    dateColumn: 'dtrndate',
    callType: 'BREAKDOWN',
    datesInSubquery: true,
  });
  const res = await postQuery({
    fields: 'COUNT(*) as total',
    tableName: crmDedupTable(from, to),
    condition: cond,
    timeoutMs: 180_000,
  });
  return n(res.data?.[0]?.total);
}

export type MidnightCrmVerifyResult = {
  ok: boolean;
  asOf: string;
  startDate: string;
  hotTotal: number;
  crmTotal: number;
  monthGaps: number;
  statusDeltas: number;
  sampleChecked: number;
  sampleMismatches: number;
};

/** YTD hot vs live CRM — totals, per-month counts, status buckets, TRN sample. */
export async function runMidnightCrmVerify(asOf: string): Promise<MidnightCrmVerifyResult> {
  const start = YTD_START();
  const istStart = `${start}T00:00:00+05:30`;
  const istEnd = `${asOf}T23:59:59.999+05:30`;
  const hotWhere = `upper(trim(call_type)) = 'BREAKDOWN'
    AND logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz`;

  const hot = await withAppClient(async (c) => {
    const total = await c.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM calls_latest_hot WHERE ${hotWhere}`,
      [istStart, istEnd]
    );
    const buckets = await c.query<{ status_bucket: string; n: string }>(
      `SELECT status_bucket, count(*)::bigint AS n FROM calls_latest_hot
       WHERE ${hotWhere} GROUP BY status_bucket`,
      [istStart, istEnd]
    );
    return {
      total: Number(total.rows[0]?.n ?? 0),
      buckets: Object.fromEntries(buckets.rows.map((b) => [b.status_bucket, Number(b.n)])),
    };
  });

  const cond = buildTrhcallsBaseCondition({
    startDate: start,
    endDate: asOf,
    dateColumn: 'dtrndate',
    callType: 'BREAKDOWN',
    datesInSubquery: true,
  });
  const crmRes = await postQuery({
    fields: CRM_SUMMARY,
    tableName: crmDedupTable(start, asOf),
    condition: cond,
    timeoutMs: 180_000,
  });
  const crm = crmRes.data?.[0] ?? {};

  const hotOpenUnalloc = hot.buckets.open_unallocated ?? 0;
  const hotAssigned = hot.buckets.assigned ?? 0;
  const hotTech = hot.buckets.tech_solved ?? 0;
  const hotClosed = hot.buckets.solved ?? 0;
  const hotCancelled = hot.buckets.cancelled ?? 0;
  const statusRows: [number, number][] = [
    [hotOpenUnalloc, n(crm.open_unallocated)],
    [hotAssigned, n(crm.assigned)],
    [hotTech, n(crm.tech_solved)],
    [hotClosed, n(crm.closed)],
    [hotCancelled, n(crm.cancelled)],
    [hotOpenUnalloc + hotAssigned, n(crm.open_calls)],
    [hotClosed + hotTech, n(crm.solved)],
  ];
  const statusDeltas = statusRows.reduce((s, [h, c]) => s + Math.abs(h - c), 0);

  let monthGaps = 0;
  for (const [from, to] of monthRanges(asOf)) {
    const h = await withAppClient(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM calls_latest_hot
         WHERE upper(trim(call_type))='BREAKDOWN'
           AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
           AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date`,
        [from, to]
      );
      return Number(r.rows[0]?.n ?? 0);
    });
    const c = await crmMonthCount(from, to);
    if (h !== c) monthGaps += 1;
  }

  const sample = await runHotCrmMismatchSampleCheck({
    sample: Number(process.env.MIDNIGHT_VERIFY_SAMPLE ?? 300) || 300,
  });

  const crmTotal = n(crm.total);
  const totalsMatch = hot.total === crmTotal;
  const ok =
    totalsMatch && monthGaps === 0 && statusDeltas === 0 && sample.mismatches === 0;

  console.log(
    `[midnight-verify] ${start}..${asOf} hot=${hot.total} crm=${crmTotal} monthGaps=${monthGaps} statusDelta=${statusDeltas} sampleMismatch=${sample.mismatches} → ${ok ? 'OK' : 'FAIL'}`
  );

  return {
    ok,
    asOf,
    startDate: start,
    hotTotal: hot.total,
    crmTotal,
    monthGaps,
    statusDeltas,
    sampleChecked: sample.checked,
    sampleMismatches: sample.mismatches,
  };
}
