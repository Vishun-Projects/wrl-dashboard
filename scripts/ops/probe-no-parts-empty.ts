import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { postQuery } from '@/lib/db/proxy';

async function q(label: string, sql: string) {
  process.stdout.write(`${label}… `);
  try {
    const res = await postQuery({ rawSql: sql, timeoutMs: 180_000 });
    console.log(JSON.stringify(res.data ?? null));
  } catch (e) {
    console.log('ERR', e instanceof Error ? e.message.slice(0, 240) : e);
  }
}

const from = process.argv[2] || '2023-01-01';
const to = process.argv[3] || '2023-01-31';

async function main() {
  console.log(`probe ${from}..${to}`);

  await q('A all by dtrndate', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'`);

  await q('B all by dsolvedatetime', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    WHERE tc.dsolvedatetime >= '${from}' AND tc.dsolvedatetime <= '${to} 23:59:59'`);

  await q('C closed by dtrndate', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'
      AND (tc.bsolved = 1 OR tc.bsolved = '1' OR tc.bsolved = 'True')`);

  await q('D breakdown by dtrndate', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    INNER JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'
      AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'`);

  await q('E closed BD by dtrndate', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    INNER JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'
      AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
      AND (tc.bsolved = 1 OR tc.bsolved = '1' OR tc.bsolved = 'True')`);

  await q('F export filter by dsolved', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    INNER JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    WHERE tc.dsolvedatetime >= '${from}' AND tc.dsolvedatetime <= '${to} 23:59:59'
      AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
      AND (tc.bsolved = 1 OR tc.bsolved = '1' OR tc.bsolved = 'True')
      AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)
      AND ISNULL(tc.vtransfercallno, '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM trdcalls3parts pt (NOLOCK)
        WHERE pt.ncalls = tc.ncode AND pt.nofficeid = tc.nofficeid
      )`);

  await q('G export filter by dtrndate', `
    SELECT COUNT(*) AS cnt FROM trhcalls tc (NOLOCK)
    INNER JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'
      AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
      AND (tc.bsolved = 1 OR tc.bsolved = '1' OR tc.bsolved = 'True')
      AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)
      AND ISNULL(tc.vtransfercallno, '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM trdcalls3parts pt (NOLOCK)
        WHERE pt.ncalls = tc.ncode AND pt.nofficeid = tc.nofficeid
      )`);

  await q('H calltype values', `
    SELECT TOP 15 calltype_fs.vdisplayvalue AS ct, COUNT(*) AS cnt
    FROM trhcalls tc (NOLOCK)
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK)
      ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    WHERE tc.dtrndate >= '${from}' AND tc.dtrndate <= '${to} 23:59:59'
    GROUP BY calltype_fs.vdisplayvalue
    ORDER BY COUNT(*) DESC`);

  await q('I earliest dtrndate overall sample', `
    SELECT TOP 5 tc.ncode, CONVERT(varchar(30), tc.dtrndate, 126) AS dtrndate,
           CONVERT(varchar(30), tc.dsolvedatetime, 126) AS dsolved, tc.bsolved
    FROM trhcalls tc (NOLOCK)
    WHERE tc.dtrndate >= '2020-01-01' AND tc.dtrndate < '2024-01-01'
    ORDER BY tc.dtrndate ASC`);

  await q('J first month with any calls 2023-2024', `
    SELECT CONVERT(varchar(7), tc.dtrndate, 126) AS ym, COUNT(*) AS cnt
    FROM trhcalls tc (NOLOCK)
    WHERE tc.dtrndate >= '2023-01-01' AND tc.dtrndate < '2024-07-01'
    GROUP BY CONVERT(varchar(7), tc.dtrndate, 126)
    ORDER BY ym`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
