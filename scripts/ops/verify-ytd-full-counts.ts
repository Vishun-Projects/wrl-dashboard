/**
 * Full YTD logged-date reconciliation: CRM vs hot totals + per-month + status (all accounts).
 *   npx tsx scripts/ops/verify-ytd-full-counts.ts 2026-08-28
 */
import '@/modules/mis-email/services/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';
import { buildTrhcallsBaseCondition } from '@/sql/trhcalls/query';
import { withAppClient, closePool } from '@/lib/read-model/db';

const START = '2026-01-01';
const AS_OF = process.argv[2]?.trim() || '2026-08-28';
const IST_START = `${START}T00:00:00+05:30`;
const IST_END = `${AS_OF}T23:59:59.999+05:30`;

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

function n(v: unknown): number {
  return Number(v ?? 0);
}

function fmt(v: number): string {
  return v.toLocaleString('en-IN');
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

async function main() {
  console.log(`=== YTD FULL COUNT CHECK ${START} → ${AS_OF} (logged, BREAKDOWN, IST) ===`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const hot = await withAppClient(async (c) => {
    const total = await c.query(
      `SELECT count(*)::bigint n FROM calls_latest_hot
       WHERE upper(trim(call_type))='BREAKDOWN' AND logged_at >= $1 AND logged_at <= $2`,
      [IST_START, IST_END]
    );
    const buckets = await c.query(
      `SELECT status_bucket, count(*)::bigint n FROM calls_latest_hot
       WHERE upper(trim(call_type))='BREAKDOWN' AND logged_at >= $1 AND logged_at <= $2
       GROUP BY status_bucket ORDER BY status_bucket`,
      [IST_START, IST_END]
    );
    return { total: Number(total.rows[0].n), buckets: buckets.rows as { status_bucket: string; n: string }[] };
  });

  const cond = buildTrhcallsBaseCondition({
    startDate: START,
    endDate: AS_OF,
    dateColumn: 'dtrndate',
    callType: 'BREAKDOWN',
    datesInSubquery: true,
  });
  const crmRes = await postQuery({
    fields: CRM_SUMMARY,
    tableName: crmDedupTable(START, AS_OF),
    condition: cond,
    timeoutMs: 180_000,
  });
  const crm = crmRes.data?.[0] ?? {};

  const hotByBucket = Object.fromEntries(hot.buckets.map((b) => [b.status_bucket, Number(b.n)]));
  const hotOpenUnalloc = hotByBucket.open_unallocated ?? 0;
  const hotAssigned = hotByBucket.assigned ?? 0;
  const hotTech = hotByBucket.tech_solved ?? 0;
  const hotClosed = hotByBucket.solved ?? 0;
  const hotCancelled = hotByBucket.cancelled ?? 0;
  const hotOpen = hotOpenUnalloc + hotAssigned;
  const hotSolved = hotClosed + hotTech;

  console.log('── TOTAL (all accounts, same window) ──');
  console.log(`Hot:  ${fmt(hot.total)}`);
  console.log(`CRM:  ${fmt(n(crm.total))}`);
  console.log(`Gap:  ${hot.total === n(crm.total) ? 'EXACT MATCH ✓' : fmt(hot.total - n(crm.total))}`);

  console.log('\n── STATUS (hot stored bucket vs CRM live flags) ──');
  const rows: [string, number, number][] = [
    ['Open Unallocated', hotOpenUnalloc, n(crm.open_unallocated)],
    ['Assigned', hotAssigned, n(crm.assigned)],
    ['Tech. Solve', hotTech, n(crm.tech_solved)],
    ['Closed (solved)', hotClosed, n(crm.closed)],
    ['Cancelled', hotCancelled, n(crm.cancelled)],
    ['Open (total)', hotOpen, n(crm.open_calls)],
    ['Solved (C+Tech)', hotSolved, n(crm.solved)],
  ];
  console.log(`${'Status'.padEnd(18)} ${'Hot'.padStart(10)} ${'CRM live'.padStart(10)} ${'Delta'.padStart(10)}`);
  for (const [label, h, c] of rows) {
    const d = h - c;
    console.log(`${label.padEnd(18)} ${fmt(h).padStart(10)} ${fmt(c).padStart(10)} ${(d >= 0 ? '+' : '') + fmt(d).padStart(d >= 0 ? 9 : 10)}`);
  }
  console.log('\n(Status deltas = CRM moved since last hot write; row totals matching means no missing TRNs.)');

  console.log('\n── PER MONTH (logged date) ──');
  const months = [
    ['2026-01-01', '2026-01-31'],
    ['2026-02-01', '2026-02-28'],
    ['2026-03-01', '2026-03-31'],
    ['2026-04-01', '2026-04-30'],
    ['2026-05-01', '2026-05-31'],
    ['2026-06-01', '2026-06-30'],
    ['2026-07-01', '2026-07-31'],
    ['2026-08-01', AS_OF],
  ];
  let monthGaps = 0;
  console.log(`${'Month'.padEnd(12)} ${'Hot'.padStart(8)} ${'CRM'.padStart(8)} ${'Delta'.padStart(8)}`);
  for (const [from, to] of months) {
    const h = await withAppClient(async (c) => {
      const r = await c.query(
        `SELECT count(*)::bigint n FROM calls_latest_hot
         WHERE upper(trim(call_type))='BREAKDOWN'
           AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
           AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date`,
        [from, to]
      );
      return Number(r.rows[0].n);
    });
    const c = await crmMonthCount(from, to);
    const d = h - c;
    if (d !== 0) monthGaps++;
    const mark = d === 0 ? '' : ' ←';
    console.log(`${from.slice(0, 7).padEnd(12)} ${fmt(h).padStart(8)} ${fmt(c).padStart(8)} ${(d >= 0 ? '+' : '') + fmt(d).padStart(d >= 0 ? 7 : 8)}${mark}`);
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log('\n── VERDICT ──');
  if (hot.total === n(crm.total) && monthGaps === 0) {
    console.log('COMPLETE — every YTD month and total TRN count matches CRM exactly.');
  } else if (hot.total === n(crm.total)) {
    console.log('TOTALS MATCH — all TRNs present. Per-month tiny drift possible on boundary dates.');
  } else {
    console.log(`GAP — ${fmt(Math.abs(hot.total - n(crm.total)))} TRN(s) difference. Run resync-missing-ytd-breakdown.ts`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
