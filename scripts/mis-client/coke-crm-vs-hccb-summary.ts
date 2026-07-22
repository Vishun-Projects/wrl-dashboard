import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';
import { queryClientAccountSummaryFiltered } from '@/features/mis-import/lib/aggregate';
import { queryBdMisCrmSummary } from '@/lib/read-model/queries/bd-mis-summary';
import { formatDisplayRegion } from '@/features/mis-import/lib/region';

const START = '2026-01-01';
const END = '2026-06-29';

async function main() {
  const crm = await queryBdMisCrmSummary({
    startDate: START,
    endDate: END,
    agingAsOf: END,
    callTypes: ['BREAKDOWN'],
    isHod: true,
  });

  const cokeAccounts = ['coke', 'hccb', 'coke oya'];
  const byZone = new Map<string, { total: number; open: number; accounts: Record<string, number> }>();

  for (const row of crm.accountSummary) {
    const acc = String(row.account ?? '').trim().toLowerCase();
    if (!cokeAccounts.includes(acc)) continue;
    const zone = formatDisplayRegion(String(row.region ?? ''));
    if (!byZone.has(zone)) byZone.set(zone, { total: 0, open: 0, accounts: {} });
    const b = byZone.get(zone)!;
    b.total += Number(row.total_calls ?? 0);
    b.open += Number(row.open_calls ?? 0);
    b.accounts[acc] = (b.accounts[acc] ?? 0) + Number(row.total_calls ?? 0);
  }

  const client = await queryClientAccountSummaryFiltered({
    sourceCodes: ['coke'],
    startDate: START,
    endDate: END,
    agingAsOf: END,
  });
  const hccb = client.reduce(
    (s, r) => ({
      total: s.total + r.total_calls,
      open: s.open + r.open_calls,
      solved: s.solved + r.total_solved,
    }),
    { total: 0, open: 0, solved: 0 }
  );

  let crmSouthCoke = 0;
  let crmSouthOpen = 0;
  let crmNonSouth = 0;
  for (const [zone, v] of byZone) {
    if (zone === 'SOUTH ZONE') {
      crmSouthCoke += v.total;
      crmSouthOpen += v.open;
    } else {
      crmNonSouth += v.total;
    }
  }

  const crmAllCoke = [...byZone.values()].reduce((s, v) => s + v.total, 0);
  const crmAllOpen = [...byZone.values()].reduce((s, v) => s + v.open, 0);

  console.log('=== Coke in CRM (portal DB, Jan 1 – Jun 29, BREAKDOWN) ===\n');
  console.log('By zone (account rollup):');
  for (const z of ['NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE']) {
    const v = byZone.get(z);
    if (!v) continue;
    console.log(`  ${z}: ${v.total} total, ${v.open} open | ${JSON.stringify(v.accounts)}`);
  }
  console.log(`\n  CRM Coke-family ALL zones: ${crmAllCoke} total, ${crmAllOpen} open`);
  console.log(`  CRM Coke-family SOUTH only:  ${crmSouthCoke} total, ${crmSouthOpen} open`);
  console.log(`  CRM Coke-family non-South:   ${crmNonSouth} total`);

  console.log('\n=== HCCB client import (South, same date range) ===');
  console.log(`  HCCB import: ${hccb.total} total, ${hccb.open} open, ${hccb.solved} solved`);

  console.log('\n=== Differences ===');
  console.log(`  HCCB vs CRM South Coke:     ${hccb.total - crmSouthCoke} more in HCCB (${((hccb.total / Math.max(crmSouthCoke, 1) - 1) * 100).toFixed(0)}% larger)`);
  console.log(`  HCCB vs CRM all Coke:       ${hccb.total - crmAllCoke} (HCCB is South-only file)`);
  console.log(`  If you ADD both South:      ${crmSouthCoke + hccb.total} (double-count territory)`);
  console.log(`  BD MIS rule (HCCB only S):  ${hccb.total} South Coke total`);

  await withAppClient(async (c) => {
    const raw = await c.query(`
      SELECT lower(trim(account)) as account,
             COALESCE(p.region_zone, upper(trim(h.region))) as region,
             count(*)::int as n,
             count(*) FILTER (WHERE lower(trim(status_label)) NOT IN ('closed','cancelled','tech solved','b fast close'))::int as openish
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= $1::date AND h.logged_at <= ($2::date + interval '1 day' - interval '1 second')
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND lower(trim(h.account)) IN ('coke','hccb','coke oya')
      GROUP BY 1, 2 ORDER BY 2, 1
    `, [START, END]);
    console.log('\n=== Raw CRM row counts (calls_latest_hot) ===');
    let t = 0;
    for (const r of raw.rows) {
      console.log(`  ${r.region} | ${r.account}: ${r.n} (${r.openish} open/assigned)`);
      t += Number(r.n);
    }
    console.log(`  Raw total: ${t}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
