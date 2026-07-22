import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { querySummaryDashboard } from '@/lib/read-model/queries/summary';
import {
  queryAllClientBranchSummary,
  queryClientAccountSummaryFiltered,
} from '@/features/mis-import/lib/aggregate';
import { prisma } from '@/lib/db/prisma';

async function main() {
  const start = '2026-07-01';
  const end = '2026-07-03';

  const crm = await querySummaryDashboard({
    startDate: start,
    endDate: end,
    agingAsOf: end,
    callTypes: ['BREAKDOWN'],
  });

  const crmSolved = crm.branchSummary.reduce((s, b) => s + b.solved_calls, 0);
  const crmTotal = crm.branchSummary.reduce((s, b) => s + b.total_calls, 0);
  const crmOpen = crm.branchSummary.reduce((s, b) => s + b.open_calls, 0);

  console.log('=== CRM only (Jul 1-3, BREAKDOWN) ===');
  console.log({ total: crmTotal, solved: crmSolved, open: crmOpen, cancelled: crm.branchSummary.reduce((s,b)=>s+b.cancelled_calls,0) });
  console.log('by region solved:', crm.branchSummary.reduce((acc,b)=>{acc[b.region]=(acc[b.region]||0)+b.solved_calls; return acc;}, {} as Record<string,number>));

  const clientCoke = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke'],
    startDate: start,
    endDate: end,
    agingAsOf: end,
  });
  const clientCadbury = await queryClientAccountSummaryFiltered({
    sourceCodes: ['cadbury'],
    startDate: start,
    endDate: end,
    agingAsOf: end,
  });
  const clientAll = await queryAllClientBranchSummary({ startDate: start, endDate: end, agingAsOf: end });

  const sum = (rows: { total_solved?: number; total_calls?: number; solved_calls?: number }[], key: 'total_solved'|'total_calls'|'solved_calls') =>
    rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

  console.log('\n=== Client import Jul 1-3 ===');
  console.log('coke solved', sum(clientCoke, 'total_solved'), 'calls', sum(clientCoke, 'total_calls'));
  console.log('cadbury solved', sum(clientCadbury, 'total_solved'), 'calls', sum(clientCadbury, 'total_calls'));
  console.log('all branch solved', sum(clientAll, 'solved_calls'), 'calls', sum(clientAll, 'total_calls'));

  const rawCrm = await prisma.$queryRawUnsafe<Array<{ region: string; total: number; solved: number }>>(
    `SELECT upper(trim(region)) as region, count(*)::int as total,
      count(*) filter (where status_bucket in ('solved','tech_solved'))::int as solved
     FROM calls_latest_hot
     WHERE logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz
       AND upper(trim(call_type)) = 'BREAKDOWN'
       AND coalesce(ncancelreason,0) <> 2
     GROUP BY 1 ORDER BY 1`,
    `${start}T00:00:00`,
    `${end}T23:59:59`
  );
  console.log('\n=== Raw hot table Jul 1-3 ===');
  console.log(rawCrm);
  console.log('raw total solved', rawCrm.reduce((s,r)=>s+r.solved,0));

  const loggedDist = await prisma.$queryRawUnsafe<Array<{ day: string; c: number }>>(
    `SELECT logged_at::date::text as day, count(*)::int as c
     FROM calls_latest_hot
     WHERE logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz
       AND upper(trim(call_type)) = 'BREAKDOWN'
     GROUP BY 1 ORDER BY 1`,
    `${start}T00:00:00`,
    `${end}T23:59:59`
  );
  console.log('\n=== Calls logged per day Jul 1-3 ===');
  console.log(loggedDist);

  const acctSolved = crm.accountSummary.reduce((acc, a) => {
    acc[a.region] = (acc[a.region] || 0) + a.total_solved;
    return acc;
  }, {} as Record<string, number>);
  console.log('\n=== CRM account summary Jul 1-3 solved by region ===');
  console.log(acctSolved);
  console.log('all account solved', crm.accountSummary.reduce((s, a) => s + a.total_solved, 0));

  for (const [start, end, label] of [
    ['2026-01-01', '2026-07-03', 'ytd'],
    ['2026-01-01', '2026-06-30', 'jan-jun'],
    ['2026-07-01', '2026-07-03', 'jul3'],
  ] as const) {
    const data = await querySummaryDashboard({
      startDate: start,
      endDate: end,
      agingAsOf: end,
      callTypes: ['BREAKDOWN'],
    });
    const southAcct = data.accountSummary
      .filter((a) => a.region === 'SOUTH ZONE')
      .reduce((s, a) => s + a.total_solved, 0);
    const southBranch = data.branchSummary
      .filter((b) => b.region === 'SOUTH ZONE')
      .reduce((s, b) => s + b.solved_calls, 0);
    const allAcct = data.accountSummary.reduce((s, a) => s + a.total_solved, 0);
    console.log(`\n=== ${label} (${start} to ${end}) ===`);
    console.log({ southAcct, southBranch, allAcct });
  }

  const cokeJul = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke'],
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
  });
  const southCokeJul = cokeJul
    .filter((a) => a.region === 'SOUTH ZONE')
    .reduce((s, a) => s + a.total_solved, 0);
  const southCrmJul = crm.accountSummary
    .filter((a) => a.region === 'SOUTH ZONE')
    .reduce((s, a) => s + a.total_solved, 0);
  console.log('\n=== South Jul 3 merge simulation ===');
  console.log({ southCrmJul, southCokeJul, addBoth: southCrmJul + southCokeJul });

  const cokeYtd = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke'],
    startDate: '2026-01-01',
    endDate: '2026-07-03',
    agingAsOf: '2026-07-03',
  });
  const southCokeYtd = cokeYtd
    .filter((a) => a.region === 'SOUTH ZONE')
    .reduce((s, a) => s + a.total_solved, 0);
  console.log({ southCokeYtd });
}

main().catch(console.error);
