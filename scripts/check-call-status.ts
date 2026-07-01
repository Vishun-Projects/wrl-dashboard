/**
 * Look up a call in calls_latest_hot, live CRM trhcalls, and sync watermarks.
 * Usage: npx tsx scripts/check-call-status.ts 26F01029
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import { withAppClient } from '@/lib/read-model/db';
import { postQuery } from '@/lib/db/proxy';
import { classifyRegisterRowStatus } from '@/lib/report/search';
import { transformCrmRowToHot } from '@/lib/read-model/transform';

const id = (process.argv[2] ?? '26F01029').trim();

async function fetchLiveCrm(vtrnno: string) {
  const sql = `
    SELECT TOP 5
      ncode, vtrnno, vcclid, nengineer, bsolved, bfastclose, ncancelreason,
      editedon, addedon, dtrndate, dsolvedatetime, vtransfercallno
    FROM trhcalls (NOLOCK)
    WHERE vtrnno = '${vtrnno.replace(/'/g, "''")}'
       OR vcclid = '${vtrnno.replace(/'/g, "''")}'
    ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
  `;
  const res = await postQuery({ rawSql: sql, timeoutMs: 120_000 });
  return (res.data ?? []) as Record<string, unknown>[];
}

async function main() {
  await withAppClient(async (client) => {
    const rows = await client.query(
      `
      SELECT vtrnno, vcclid, ncode, status_label, status_bucket,
             bsolved, bfastclose, ncancelreason, edited_at, source_editedon,
             synced_at, logged_at, engineer_name, account, branch_name,
             franchisee_name, call_type
      FROM calls_latest_hot
      WHERE lower(trim(vtrnno)) = lower($1)
         OR lower(trim(vcclid)) = lower($1)
         OR trim(vcclid) = $2
      LIMIT 5
      `,
      [id, id.replace(/^26F/i, '')]
    );
    console.log('=== Portal calls_latest_hot ===');
    console.log(JSON.stringify(rows.rows, null, 2));

    const sync = await client.query(
      `SELECT entity, last_editedon, last_addedon, status
       FROM sync_state WHERE entity = 'calls_latest_hot'`
    );
    console.log('\n=== sync_state ===');
    console.log(JSON.stringify(sync.rows, null, 2));

    const wm = sync.rows[0]?.last_editedon as Date | null;
    const hot = rows.rows[0];
    if (hot && wm && hot.source_editedon) {
      const hotEdit = new Date(hot.source_editedon as string);
      console.log(
        `\nHot source_editedon ${hotEdit.toISOString()} vs sync watermark ${new Date(wm).toISOString()} — ${
          hotEdit >= new Date(wm) ? 'WOULD be in incremental window if CRM row unchanged' : 'BELOW watermark (incremental will not re-fetch unless editedon advances)'
        }`
      );
    } else if (hot) {
      console.log(
        '\nHot row has null source_editedon — incremental sync only picks rows where CRM editedon >= watermark'
      );
    }
  });

  console.log('\n=== Live CRM trhcalls ===');
  try {
    const crmRows = await fetchLiveCrm(id);
    if (!crmRows.length) {
      console.log('No CRM rows found');
      return;
    }
    for (const row of crmRows) {
      const bucket = classifyRegisterRowStatus(row);
      const hot = transformCrmRowToHot(row);
      console.log({
        ncode: row.ncode,
        vtrnno: row.vtrnno,
        vcclid: row.vcclid,
        ncancelreason: row.ncancelreason,
        nengineer: row.nengineer,
        editedon: row.editedon,
        addedon: row.addedon,
        portalBucket: bucket,
        hotStatus: hot?.status_bucket ?? null,
        incrementalEligible:
          wmEligible(row.editedon ?? row.addedon, '2026-06-30T18:29:59.000Z'),
      });
    }
  } catch (err) {
    console.error('CRM fetch failed:', err instanceof Error ? err.message : err);
  }
}

function wmEligible(editedon: unknown, watermarkIso: string): boolean {
  const d = editedon instanceof Date ? editedon : new Date(String(editedon));
  if (Number.isNaN(d.getTime())) return false;
  return d >= new Date(watermarkIso);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
