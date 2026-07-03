import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { querySummaryDashboard } from '@/lib/read-model/queries/summary';
import { queryRegisterTotalsFromPostgres } from '@/lib/read-model/queries/register';
import { prisma } from '@/lib/db/prisma';

async function main() {
  const params = {
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
    callTypes: ['BREAKDOWN'],
    isHod: true,
    assignedOffices: [] as string[],
  };

  const summary = await querySummaryDashboard(params);
  const reg = await queryRegisterTotalsFromPostgres({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    officeId: null,
    callType: 'BREAKDOWN',
    isHod: true,
    assignedOffices: [],
    search: '',
    pincode: '',
    account: null,
    region: null,
    state: null,
    city: null,
    branch: null,
    franchisee: null,
    technician: null,
    status: null,
    priority: null,
    portal: null,
  });

  const branchTotal = summary.branchSummary.reduce((s, b) => s + b.total_calls, 0);
  const branchSolved = summary.branchSummary.reduce((s, b) => s + b.solved_calls, 0);
  const branchCancelled = summary.branchSummary.reduce((s, b) => s + b.cancelled_calls, 0);
  const branchOpen = summary.branchSummary.reduce((s, b) => s + b.open_calls, 0);

  const acctTotal = summary.accountSummary.reduce((s, a) => s + a.total_calls, 0);
  const acctSolved = summary.accountSummary.reduce((s, a) => s + a.total_solved, 0);
  const acctCancelled = summary.accountSummary.reduce((s, a) => s + a.cancelled_calls, 0);
  const acctOpen = summary.accountSummary.reduce((s, a) => s + a.open_calls, 0);

  const missing = await prisma.$queryRawUnsafe<
    Array<{ n: number }>
  >(
    `
    SELECT count(*)::int AS n
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    WHERE h.logged_at >= '2026-07-01T00:00:00'::timestamptz
      AND h.logged_at <= '2026-07-03T23:59:59'::timestamptz
      AND upper(trim(h.call_type)) = 'BREAKDOWN'
      AND (h.account IS NULL OR trim(h.account) = '')
    `
  );

  const normalizeDiff = await prisma.$queryRawUnsafe<
    Array<{ upper_trim: number; normalize: number }>
  >(
    `
    SELECT
      count(*) FILTER (WHERE upper(trim(h.call_type)) = 'BREAKDOWN')::int AS upper_trim,
      count(*) FILTER (WHERE normalize_call_type(h.call_type) = normalize_call_type('BREAKDOWN'))::int AS normalize
    FROM calls_latest_hot h
    WHERE h.logged_at >= '2026-07-01T00:00:00'::timestamptz
      AND h.logged_at <= '2026-07-03T23:59:59'::timestamptz
    `
  );

  console.log('=== Jul 1-3 BREAKDOWN CRM alignment ===');
  console.log('Register:', reg.summary, 'total', reg.total);
  console.log('Branch rollup:', { branchTotal, branchSolved, branchCancelled, branchOpen });
  console.log('Account rollup:', { acctTotal, acctSolved, acctCancelled, acctOpen });
  console.log('Summary UI total_calls display (branch+cancelled):', branchTotal + branchCancelled);
  console.log('KAMIS-style gaps:', {
    totalGap: branchTotal - acctTotal,
    solvedGap: branchSolved - acctSolved,
    openGap: branchOpen - acctOpen,
  });
  console.log('Calls with blank account:', missing[0]?.n ?? 0);
  console.log('Call type filter diff:', normalizeDiff[0]);

  const excl = summary.accountSummary.filter(
    (a) => !['DEALER', 'GENERAL'].includes(String(a.account).trim().toUpperCase())
  );
  const sum = (rows: typeof summary.accountSummary, f: keyof (typeof summary.accountSummary)[0]) =>
    rows.reduce((s, a) => s + Number(a[f] ?? 0), 0);
  console.log('Excl DEALER/GENERAL:', {
    total: sum(excl, 'total_calls'),
    solved: sum(excl, 'total_solved'),
    open: sum(excl, 'open_calls'),
  });

  const allTypes = await querySummaryDashboard({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
    callTypes: [],
    isHod: true,
    assignedOffices: [],
  });
  const breakdownOnly = await querySummaryDashboard({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
    callTypes: ['BREAKDOWN'],
    isHod: true,
    assignedOffices: [],
  });
  const sumAcct = (rows: typeof allTypes.accountSummary, f: keyof (typeof allTypes.accountSummary)[0]) =>
    rows.reduce((s, a) => s + Number(a[f] ?? 0), 0);
  console.log('Account rollup All types:', {
    total: sumAcct(allTypes.accountSummary, 'total_calls'),
    solved: sumAcct(allTypes.accountSummary, 'total_solved'),
  });
  console.log('Account rollup BREAKDOWN only:', {
    total: sumAcct(breakdownOnly.accountSummary, 'total_calls'),
    solved: sumAcct(breakdownOnly.accountSummary, 'total_solved'),
  });
  console.log('Branch rollup All types:', {
    total: allTypes.branchSummary.reduce((s, b) => s + b.total_calls, 0),
    solved: allTypes.branchSummary.reduce((s, b) => s + b.solved_calls, 0),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
