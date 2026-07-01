/**
 * Live CRM (DBQUERY) check for 13 blank-region TRNs.
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { postQuery } from '@/lib/db/proxy';
import { withAppClient } from '@/lib/read-model/db';

const TRNS = [
  '26F041532', '26D081572', '26F181227', '26F171273', '26F29824', '26D08674',
  '26D021121', '26C021379', '26D255059', '26E07335', '26D071029', '26D09689', '26F22746',
];

async function main() {
  const inList = TRNS.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');

  const sql = `
SELECT TOP 20
  tc.vtrnno,
  tc.nofficeid,
  o.vcompanyname AS office_name,
  o.nunder AS office_under,
  o.nzone AS office_nzone,
  op.nzone AS parent_nzone,
  z.vname AS zone_name,
  ISNULL(UPPER(z.vname), 'OTHER') AS region_computed,
  pprof.vname AS account,
  tc.callStatus,
  tc.bsolved,
  tc.dtrndate
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY CASE WHEN ISNULL(vtrnno,'')='' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
    ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
  ) AS rn
  FROM trhcalls (NOLOCK)
  WHERE vtrnno IN (${inList})
) tc
LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
LEFT JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
LEFT JOIN mstzones z (NOLOCK) ON (
  CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END
) = z.ncode
WHERE tc.rn = 1
ORDER BY tc.vtrnno
`;

  console.log('=== Live CRM (westerncrm.com DBQUERY) ===\n');
  const res = await postQuery({ rawSql: sql, timeoutMs: 180_000 });
  const rows = (res.data || []) as Record<string, unknown>[];
  console.log(`Rows returned: ${rows.length}\n`);

  for (const r of rows) {
    console.log({
      vtrnno: r.vtrnno,
      account: r.account,
      office: r.office_name,
      office_nzone: r.office_nzone,
      parent_nzone: r.parent_nzone,
      zone_name: r.zone_name,
      region_computed: r.region_computed,
      status: r.callStatus,
      bsolved: r.bsolved,
      date: r.dtrndate,
    });
  }

  await withAppClient(async (c) => {
    const hot = await c.query(`
      SELECT vtrnno, region, account, branch_name, status_bucket::text
      FROM calls_latest_hot
      WHERE vtrnno = ANY($1::text[])
      ORDER BY vtrnno
    `, [TRNS]);
    console.log('\n=== Portal DB (calls_latest_hot) now ===');
    for (const r of hot.rows) {
      console.log(r);
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
