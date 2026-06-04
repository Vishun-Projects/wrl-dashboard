import { postQuery } from '../src/lib/db/proxy';

async function q(label: string, sql: string) {
  try {
    const r = await postQuery({ rawSql: sql, timeoutMs: 90000 });
    console.log('---', label, (r.data || []).length);
    for (const row of (r.data || []) as Record<string, unknown>[]) console.log(row);
  } catch (e) {
    console.log('---', label, e instanceof Error ? e.message.slice(0, 200) : e);
  }
}

async function main() {
  await q(
    'trhcalls ncode 2130',
    `SELECT TOP 1 ncode, vtrnno, vserialno, nitemserialno, dtrndate, dsolvedatetime, dapprovedon, addedon, editedon, nofficeid
     FROM trhcalls (NOLOCK) WHERE ncode = '2130'`
  );
  await q(
    'trhcalls editedon exact 15/04/2026 16:29:09',
    `SELECT TOP 10 ncode, vtrnno, vserialno, editedon, addedon
     FROM trhcalls (NOLOCK) WHERE LTRIM(RTRIM(CAST(editedon AS VARCHAR(30)))) = '15/04/2026 16:29:09'`
  );
  await q(
    'trdcalls10ARCP serials',
    `SELECT TOP 10 ncode, vucnno, vitemserialno, nitemserialno, dbmapproveddate, dapproval1on, dhoapproveddate, addedon, editedon, ncalls2fault, nvisit, nofficeid
     FROM trdcalls10ARCP (NOLOCK) WHERE vitemserialno = '42213251100902'`
  );
  await q(
    'trdcalls2fault ncalls 2130',
    `SELECT TOP 5 ncode, ncalls, nofficeid, addedon, editedon FROM trdcalls2fault (NOLOCK) WHERE ncalls = '2130'`
  );
  await q(
    'trdcalls1visit ncalls 2130',
    `SELECT TOP 5 ncode, ncalls, nofficeid, dvisitdatetime, addedon, editedon FROM trdcalls1visit (NOLOCK) WHERE ncalls = '2130'`
  );
  await q(
    'trhcalls by serial/TRN',
    `SELECT TOP 20 ncode, nofficeid, vtrnno, vserialno, nitemserialno, dtrndate, editedon, addedon
     FROM trhcalls (NOLOCK)
     WHERE vserialno = '42213251100902' OR vtrnno = '26B20231'
     ORDER BY editedon DESC`
  );
  await q(
    'trhcalls editedon like 16:29:09',
    `SELECT TOP 10 ncode, nofficeid, vtrnno, vserialno, editedon
     FROM trhcalls (NOLOCK)
     WHERE editedon LIKE '%15/04/2026%16:29:09%'`
  );
  await q(
    'meditedon mobile audit',
    `SELECT TOP 5 ncode, nofficeid, vtrnno, vserialno, meditedon, maddedon
     FROM trhcalls (NOLOCK)
     WHERE vserialno = '42213251100902' OR vtrnno = '26B20231'`
  );
}

main().catch(console.error);
