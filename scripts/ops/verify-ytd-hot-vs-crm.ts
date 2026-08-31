/**
 * Quick YTD hot vs CRM count check (status tallies, no row trace).
 *   npx tsx scripts/ops/verify-ytd-hot-vs-crm.ts
 *   npx tsx scripts/ops/verify-ytd-hot-vs-crm.ts 2026-08-27
 */
import '@/modules/mis-email/services/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { postQuery } from '@/lib/db/proxy';
import { buildTrhcallsBaseCondition } from '@/sql/trhcalls/query';

const START = '2026-01-01';
const AS_OF = process.argv[2]?.trim() || '2026-08-27';
const EXCL = ['cadbury', 'mondelez', 'coke', 'hccb'];
const IST_START = `${START}T00:00:00+05:30`;
const IST_END = `${AS_OF}T23:59:59.999+05:30`;

const HOT_WHERE = `upper(trim(call_type)) = 'BREAKDOWN'
  AND logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz`;

const NOT_CANCELLED_SQL =
  '(tc.ncancelreason IS NULL OR tc.ncancelreason = 0 OR tc.ncancelreason = 2)';

const SOLVED_FLAGS =
  "((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1))";

const CRM_SUMMARY_FIELDS = `
  COUNT(*) as total,
  SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled,
  SUM(CASE WHEN ${NOT_CANCELLED_SQL} AND ${SOLVED_FLAGS} THEN 1 ELSE 0 END) as solved,
  SUM(CASE WHEN NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls,
  SUM(CASE WHEN (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_unallocated,
  SUM(CASE WHEN (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND NOT ${SOLVED_FLAGS} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as assigned,
  SUM(CASE WHEN (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND NOT (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as tech_solved,
  SUM(CASE WHEN (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as closed
`;

function crmDedupTableName(startDate: string, endDate: string): string {
  const esc = (d: string) => d.replace(/'/g, "''");
  return `(
      SELECT *
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
            ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
          ) as rn
        FROM trhcalls (NOLOCK)
        WHERE dtrndate >= '${esc(startDate)}' AND dtrndate <= '${esc(endDate)} 23:59:59'
      ) s
      WHERE s.rn = 1
    ) tc`;
}

function n(v: unknown): number {
  return Number(v ?? 0);
}

function fmt(v: number): string {
  return v.toLocaleString('en-IN');
}

function pctDiff(hot: number, crm: number): string {
  if (!crm) return 'n/a';
  const d = hot - crm;
  return `${d >= 0 ? '+' : ''}${fmt(d)} (${((d / crm) * 100).toFixed(2)}%)`;
}

async function hotStats(exclAccounts: boolean) {
  return withAppClient(async (c) => {
    const excl = exclAccounts
      ? ` AND lower(coalesce(account, '')) <> ALL($3::text[])`
      : '';
    const params: unknown[] = [IST_START, IST_END];
    if (exclAccounts) params.push(EXCL);

    const buckets = await c.query(
      `SELECT status_bucket, count(*)::bigint AS n
       FROM calls_latest_hot
       WHERE ${HOT_WHERE}${excl}
       GROUP BY status_bucket ORDER BY status_bucket`,
      params
    );
    const total = await c.query(
      `SELECT count(*)::bigint AS n FROM calls_latest_hot WHERE ${HOT_WHERE}${excl}`,
      params
    );
    return {
      total: Number(total.rows[0]?.n ?? 0),
      buckets: buckets.rows as { status_bucket: string; n: string }[],
    };
  });
}

async function crmSummary() {
  const condition = buildTrhcallsBaseCondition({
    startDate: START,
    endDate: AS_OF,
    dateColumn: 'dtrndate',
    callType: 'BREAKDOWN',
    datesInSubquery: true,
  });
  const res = await postQuery({
    fields: CRM_SUMMARY_FIELDS,
    tableName: crmDedupTableName(START, AS_OF),
    condition,
    timeoutMs: 180_000,
  });
  const row = res.data?.[0] ?? {};
  return {
    total: n(row.total),
    open: n(row.open_calls),
    openUnallocated: n(row.open_unallocated),
    assigned: n(row.assigned),
    techSolved: n(row.tech_solved),
    closed: n(row.closed),
    solved: n(row.solved),
    cancelled: n(row.cancelled),
  };
}

async function main() {
  console.log(`=== YTD BREAKDOWN logged ${START} → ${AS_OF} (IST) ===`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  const [hotAll, hotExcl, crm] = await Promise.all([
    hotStats(false),
    hotStats(true),
    crmSummary(),
  ]);

  const hotByBucket = Object.fromEntries(
    hotExcl.buckets.map((b) => [b.status_bucket, Number(b.n)])
  );
  const hotOpenUnalloc = hotByBucket.open_unallocated ?? 0;
  const hotAssigned = hotByBucket.assigned ?? 0;
  const hotTech = hotByBucket.tech_solved ?? 0;
  const hotClosed = hotByBucket.solved ?? 0;
  const hotCancelled = hotByBucket.cancelled ?? 0;
  const hotOpen = hotOpenUnalloc + hotAssigned;
  const hotSolved = hotClosed + hotTech;

  console.log('── SYNCED (calls_latest_hot) ──');
  console.log(`Total (all accounts):     ${fmt(hotAll.total)}`);
  console.log(`Total (excl key accts):   ${fmt(hotExcl.total)}  ← midnight mail basis`);
  console.log('status_bucket (excl key accts):');
  for (const b of hotExcl.buckets) {
    console.log(`  ${String(b.status_bucket).padEnd(18)} ${fmt(Number(b.n))}`);
  }

  console.log('\n── LIVE CRM (trhcalls, same window) ──');
  console.log(`Total:                    ${fmt(crm.total)}`);
  console.log(`Open (total):             ${fmt(crm.open)}`);
  console.log(`Open Unallocated:         ${fmt(crm.openUnallocated)}`);
  console.log(`Assigned:                 ${fmt(crm.assigned)}`);
  console.log(`Tech. Solve:              ${fmt(crm.techSolved)}`);
  console.log(`Closed:                   ${fmt(crm.closed)}`);
  console.log(`Solved (C+Tech):          ${fmt(crm.solved)}`);
  console.log(`Cancelled:                ${fmt(crm.cancelled)}`);

  console.log('\n── HOT vs CRM delta (excl key accts vs CRM all) ──');
  console.log(`Total:           hot ${fmt(hotExcl.total)}  vs  CRM ${fmt(crm.total)}  →  ${pctDiff(hotExcl.total, crm.total)}`);
  console.log(`Open:            hot ${fmt(hotOpen)}  vs  CRM ${fmt(crm.open)}  →  ${pctDiff(hotOpen, crm.open)}`);
  console.log(`Open Unalloc:    hot ${fmt(hotOpenUnalloc)}  vs  CRM ${fmt(crm.openUnallocated)}  →  ${pctDiff(hotOpenUnalloc, crm.openUnallocated)}`);
  console.log(`Assigned:        hot ${fmt(hotAssigned)}  vs  CRM ${fmt(crm.assigned)}  →  ${pctDiff(hotAssigned, crm.assigned)}`);
  console.log(`Tech. Solve:     hot ${fmt(hotTech)}  vs  CRM ${fmt(crm.techSolved)}  →  ${pctDiff(hotTech, crm.techSolved)}`);
  console.log(`Closed:          hot ${fmt(hotClosed)}  vs  CRM ${fmt(crm.closed)}  →  ${pctDiff(hotClosed, crm.closed)}`);
  console.log(`Solved:          hot ${fmt(hotSolved)}  vs  CRM ${fmt(crm.solved)}  →  ${pctDiff(hotSolved, crm.solved)}`);
  console.log(`Cancelled:       hot ${fmt(hotCancelled)}  vs  CRM ${fmt(crm.cancelled)}  →  ${pctDiff(hotCancelled, crm.cancelled)}`);

  const totalGap = Math.abs(hotExcl.total - crm.total);
  const pctGap = crm.total ? (totalGap / crm.total) * 100 : 0;
  console.log('\n── Verdict ──');
  if (pctGap < 0.5) {
    console.log('YTD sync looks COMPLETE — totals within 0.5% of live CRM.');
  } else if (pctGap < 2) {
    console.log('YTD sync CLOSE — small drift (status changes since last sync or account filter skew).');
  } else {
    console.log('YTD sync has GAP — worth checking sync logs or re-running hot sync.');
  }
  console.log(
    '(CRM is live now; hot was last synced ~28 Aug 00:00–02:23 IST. Status deltas = calls moved since sync.)'
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
