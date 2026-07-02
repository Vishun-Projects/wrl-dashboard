import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { prisma } from '@/lib/db/prisma';
import {
  HOT_MAIN_BRANCH_NAME_SQL,
  HOT_MAIN_BRANCH_OFFICE_ID_SQL,
  HOT_OFFICE_JOINS_SQL,
  HOT_RESOLVED_REGION_SQL,
} from '@/lib/read-model/queries/hot-region';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

async function main() {
  const periodStart = '2026-01-01T00:00:00';
  const periodEnd = '2026-07-02T23:59:59';

  const branchCounts = await prisma.$queryRawUnsafe<
    Array<{ branch: string; region: string; office_id: number; total_calls: number }>
  >(
    `
    SELECT
      ${HOT_MAIN_BRANCH_OFFICE_ID_SQL} AS office_id,
      ${HOT_MAIN_BRANCH_NAME_SQL} AS branch,
      ${HOT_RESOLVED_REGION_SQL} AS region,
      count(*)::int AS total_calls
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      AND upper(trim(h.call_type)) = 'BREAKDOWN'
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
      AND ${HOT_MAIN_BRANCH_NAME_SQL} ~* '(WEST|SOUTH|EAST|NORTH)\\s+REGION'
    GROUP BY 1, 2, 3
    ORDER BY total_calls DESC
    `,
    periodStart,
    periodEnd
  );

  console.log('=== Branch rows with REGION label (summary logic) ===');
  console.log(JSON.stringify(branchCounts, null, 2));

  for (const row of branchCounts.slice(0, 4)) {
    const samples = await prisma.$queryRawUnsafe<
      Array<{
        vtrnno: string;
        nofficeid: number;
        office_name: string | null;
        parent_id: number | null;
        parent_name: string | null;
        branch_name: string | null;
        franchisee_name: string | null;
        region: string | null;
        resolved_branch: string;
        party_name: string | null;
        logged_at: Date;
        status_bucket: string;
        account: string | null;
      }>
    >(
      `
      SELECT
        h.vtrnno,
        h.nofficeid,
        d.vcompanyname AS office_name,
        d.nunder AS parent_id,
        dp_reg.vcompanyname AS parent_name,
        h.branch_name,
        h.franchisee_name,
        h.region,
        ${HOT_MAIN_BRANCH_NAME_SQL} AS resolved_branch,
        h.party_name,
        h.logged_at,
        h.status_bucket,
        h.account
      FROM calls_latest_hot h
      LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
      ${HOT_OFFICE_JOINS_SQL}
      WHERE h.logged_at >= $1::timestamptz
        AND h.logged_at <= $2::timestamptz
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
        AND ${HOT_MAIN_BRANCH_NAME_SQL} = $3
        AND ${HOT_RESOLVED_REGION_SQL} = $4
      ORDER BY h.logged_at DESC
      LIMIT 8
      `,
      periodStart,
      periodEnd,
      row.branch,
      row.region
    );

    console.log(`\n=== Sample CRM calls → ${row.branch} (${row.region}) — ${row.total_calls} total ===`);
    for (const s of samples) {
      console.log({
        callId: s.vtrnno,
        officeId: s.nofficeid,
        officeName: s.office_name,
        parentId: s.parent_id,
        parentName: s.parent_name,
        hotBranchName: s.branch_name,
        franchisee: s.franchisee_name,
        hotRegion: s.region,
        resolvedBranch: s.resolved_branch,
        customer: s.party_name,
        account: s.account,
        status: s.status_bucket,
        loggedAt: s.logged_at?.toISOString?.()?.slice(0, 10),
      });
    }
  }

  const clientSamples = await prisma.$queryRawUnsafe<
    Array<{
      source_code: string;
      call_key: string;
      region: string;
      branch_label: string | null;
      account: string;
      status_bucket: string;
      logged_at: Date | null;
    }>
  >(
    `
    SELECT r.source_code, r.call_key, r.region, r.branch_label, r.account, r.status_bucket, r.logged_at
    FROM mis_client_import_rows r
    JOIN mis_client_import_batches b ON b.id = r.batch_id
    WHERE b.is_latest = true
      AND r.logged_at >= $1::date
      AND r.logged_at <= $2::date
      AND upper(trim(r.call_type)) = 'BREAKDOWN'
      AND (
        COALESCE(NULLIF(trim(r.branch_label), ''), r.region) ~* '(WEST|SOUTH|EAST|NORTH)\\s+REGION'
      )
    ORDER BY r.logged_at DESC
    LIMIT 12
    `,
    '2026-01-01',
    '2026-07-02'
  );

  console.log('\n=== Sample Cadbury/Coke import rows with REGION as branch_label fallback ===');
  for (const s of clientSamples) {
    console.log({
      source: s.source_code,
      callKey: s.call_key,
      region: s.region,
      branchLabel: s.branch_label,
      effectiveBranch: s.branch_label?.trim() || s.region,
      account: s.account,
      status: s.status_bucket,
      loggedAt: s.logged_at?.toISOString?.()?.slice(0, 10) ?? null,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
