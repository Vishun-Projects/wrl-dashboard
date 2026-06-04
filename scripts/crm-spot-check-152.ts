import { postQuery } from '../src/lib/db/proxy';

const sql = `
SELECT TOP 20
  ncode,
  nofficeid,
  nofficetype,
  vitemserialno,
  nitemserialno,
  dbmapproveddate,
  dapproval1on,
  breject,
  nitemcategory
FROM trdcalls10ARCP (NOLOCK)
WHERE nofficeid = '152'
  AND ${`COALESCE(
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))), ''), 103),
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dapproval1on AS VARCHAR(30)))), ''), 103)
  ) >= '2026-04-01' AND COALESCE(
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))), ''), 103),
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(dapproval1on AS VARCHAR(30)))), ''), 103)
  ) <= '2026-04-30 23:59:59'`}
ORDER BY ncode DESC`;

async function main() {
  const res = await postQuery({ rawSql: sql, timeoutMs: 180000 });
  const rows = (res.data || []) as Record<string, unknown>[];
  console.log('April BM sample rows', rows.length);

  const d13 = `
SELECT TOP 50 ncode, dbmapproveddate, dapproval1on, vitemserialno, nitemcategory, ntraveltype, breject
FROM trdcalls10ARCP (NOLOCK)
WHERE nofficeid = '152'
  AND (
    NULLIF(LTRIM(RTRIM(CAST(dapproval1on AS VARCHAR(30)))), '') LIKE '%13/04/2026%'
    OR NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))), '') LIKE '%13/04/2026%'
  )
ORDER BY ncode DESC`;
  const r13 = await postQuery({ rawSql: d13, timeoutMs: 180000 });
  console.log('\nRows with 13-Apr in dapproval1on OR dbmapproveddate:', (r13.data || []).length);
  for (const r of (r13.data || []).slice(0, 8) as Record<string, unknown>[]) {
    console.log({ ncode: r.ncode, dbm: r.dbmapproveddate, d1: r.dapproval1on, serial: r.vitemserialno });
  }

  const portal = `
SELECT TOP 100 PERCENT ncode
FROM trdcalls10ARCP arcp (NOLOCK)
WHERE arcp.nofficeid = '152' AND arcp.nofficetype = '3'
  AND COALESCE(TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''), 103),
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 103)) >= '2026-04-01'
  AND COALESCE(TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''), 103),
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 103)) <= '2026-04-30 23:59:59'
  AND ISNULL(arcp.breject,'0') NOT IN ('1','True','true')
  AND (ISNULL(arcp.ntraveltype,'')<>'' AND arcp.ntraveltype<>'0' OR (ISNULL(arcp.nitemcategory,'')<>'' AND arcp.nitemcategory<>'0'))`;
  const p = await postQuery({ rawSql: portal, timeoutMs: 180000 });
  console.log('\nPortal-ish (no category join):', (p.data || []).length);

  const totals = [
    ["nofficeid=152 only", `nofficeid='152'`],
    ["+ April BM COALESCE", `nofficeid='152' AND COALESCE(TRY_CONVERT(DATETIME,NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))),'') ,103),TRY_CONVERT(DATETIME,NULLIF(LTRIM(RTRIM(CAST(dapproval1on AS VARCHAR(30)))),'') ,103))>='2026-04-01' AND COALESCE(TRY_CONVERT(DATETIME,NULLIF(LTRIM(RTRIM(CAST(dbmapproveddate AS VARCHAR(30)))),'') ,103),TRY_CONVERT(DATETIME,NULLIF(LTRIM(RTRIM(CAST(dapproval1on AS VARCHAR(30)))),'') ,103))<='2026-04-30 23:59:59'`],
  ];
  for (const [label, where] of totals) {
    const q = `SELECT TOP 100 PERCENT ncode FROM trdcalls10ARCP (NOLOCK) WHERE ${where}`;
    const t = await postQuery({ rawSql: q, timeoutMs: 180000 });
    console.log(`${label}:`, (t.data || []).length);
  }
}

main().catch(console.error);
