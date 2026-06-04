/**
 * Compare portal ARCP rules vs raw trdcalls10ARCP (same franchisee).
 *
 * Usage:
 *   npx tsx scripts/audit-arcp-vs-raw-crm.ts 2026-04-01 2026-04-30 152
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { postQuery } from '../src/lib/db/proxy';
import { buildArcpClaimsFilterCondition } from '../src/lib/arcp-claims/query';
import { escapeCsvCell } from '../src/lib/utils/csv';

const startDate = process.argv[2] || '2026-04-01';
const endDate = process.argv[3] || '2026-04-30';
const franchisee = process.argv[4] || '152';

const ARCP_NOT_REJECTED = `
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')`;

const ARCP_BM_APPROVE_DT = `COALESCE(
  TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''), 103),
  COALESCE(
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 126),
    TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''), 103)
  )
)`;

const ARCP_BM_MARKED = `(
  NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), '') IS NOT NULL
  OR ISNULL(arcp.bapproved, '0') IN ('1', 'True', 'true')
  OR TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(arcp.nbmapprovedamt AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) > 0
)`;

const PORTAL_WHERE = buildArcpClaimsFilterCondition({
  startDate,
  endDate,
  dateFilterColumn: 'bm_approved_at',
  franchisee,
  isHod: true,
}) + ARCP_NOT_REJECTED + `
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND EXISTS (
        SELECT 1 FROM mstitemcategory ic (NOLOCK)
        WHERE CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
          AND COALESCE(NULLIF(LTRIM(RTRIM(ic.vname)), ''), NULLIF(LTRIM(RTRIM(ic.vshortname)), '')) IS NOT NULL
      )
    )
  )`;

async function count(where: string): Promise<number> {
  const sql = `
SELECT COUNT(*) AS c FROM (
  SELECT TOP 100 PERCENT arcp.ncode
  FROM trdcalls10ARCP arcp (NOLOCK)
  WHERE ${where}
) q`;
  const res = await postQuery({ rawSql: sql, timeoutMs: 180_000 });
  return Number((res.data?.[0] as Record<string, unknown>)?.c ?? 0);
}

async function fetchSample(where: string, limit = 5000): Promise<Record<string, unknown>[]> {
  const sql = `
SELECT TOP ${limit}
  arcp.ncode,
  arcp.nofficetype,
  arcp.nofficeid,
  arcp.vucnno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.vitemserialno AS VARCHAR(80)))), '') AS vitemserialno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.nitemserialno AS VARCHAR(80)))), '') AS nitemserialno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), '') AS dbmapproveddate,
  CONVERT(varchar(30), arcp.dapproval1on, 103) AS dapproval1on,
  CONVERT(varchar(30), arcp.dapproval2on, 103) AS dapproval2on,
  arcp.ntraveltype,
  arcp.nitemcategory,
  arcp.breject,
  arcp.brejectho,
  arcp.nbmapprovedamt,
  arcp.bapproved,
  ic.vname AS item_category_name
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN mstitemcategory ic (NOLOCK)
  ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
WHERE ${where}
ORDER BY arcp.ncode`;
  const res = await postQuery({ rawSql: sql, timeoutMs: 300_000 });
  return (res.data || []) as Record<string, unknown>[];
}

function dayOnly(s: unknown): string {
  const t = String(s ?? '').trim();
  const m = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : '';
}

async function main() {
  console.log(`\nARCP audit: franchisee ${franchisee}, ${startDate} → ${endDate}\n`);

  const counts: { label: string; n: number }[] = [];

  counts.push({
    label: 'A) Raw: nofficeid only (his TOP 10 style, all dates)',
    n: await count(`arcp.nofficeid = '${franchisee}'`),
  });
  counts.push({
    label: "B) Raw + nofficetype=3 (franchise ARCP only)",
    n: await count(`arcp.nofficeid = '${franchisee}' AND arcp.nofficetype = '3'`),
  });
  counts.push({
    label: 'C) + BM date in April (portal date filter, no extra rules)',
    n: await count(
      `arcp.nofficeid = '${franchisee}' AND arcp.nofficetype = '3' AND ${ARCP_BM_MARKED} AND ${ARCP_BM_APPROVE_DT} >= '${startDate}' AND ${ARCP_BM_APPROVE_DT} <= '${endDate} 23:59:59'`
    ),
  });
  counts.push({
    label: 'D) + not rejected',
    n: await count(
      `arcp.nofficeid = '${franchisee}' AND arcp.nofficetype = '3' AND ${ARCP_BM_MARKED} AND ${ARCP_BM_APPROVE_DT} >= '${startDate}' AND ${ARCP_BM_APPROVE_DT} <= '${endDate} 23:59:59'${ARCP_NOT_REJECTED}`
    ),
  });
  counts.push({
    label: 'E) Full portal rules (eligible line + category)',
    n: await count(PORTAL_WHERE),
  });

  for (const { label, n } of counts) {
    console.log(`  ${label}: ${n}`);
  }

  const portalRows = await fetchSample(PORTAL_WHERE);
  const rawBmApril = await fetchSample(
    `arcp.nofficeid = '${franchisee}' AND arcp.nofficetype = '3' AND ${ARCP_BM_MARKED} AND ${ARCP_BM_APPROVE_DT} >= '${startDate}' AND ${ARCP_BM_APPROVE_DT} <= '${endDate} 23:59:59'${ARCP_NOT_REJECTED}`,
    8000
  );

  const portalNcodes = new Set(portalRows.map((r) => String(r.ncode)));
  const excluded = rawBmApril.filter((r) => !portalNcodes.has(String(r.ncode)));

  const bmDayPortal = new Map<string, number>();
  const bmDayRaw = new Map<string, number>();
  const d1DayRaw = new Map<string, number>();

  for (const r of portalRows) {
    const d = dayOnly(r.dbmapproveddate) || dayOnly(r.dapproval1on);
    if (d) bmDayPortal.set(d, (bmDayPortal.get(d) || 0) + 1);
  }
  for (const r of rawBmApril) {
    const db = dayOnly(r.dbmapproveddate);
    const d1 = dayOnly(r.dapproval1on);
    if (db) bmDayRaw.set(db, (bmDayRaw.get(db) || 0) + 1);
    if (d1) d1DayRaw.set(d1, (d1DayRaw.get(d1) || 0) + 1);
  }

  console.log('\n── BM date days (portal set) — dbmapproved or dapproval1on on row ──');
  [...bmDayPortal.entries()].sort().forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  console.log('\n── Raw BM April: dbmapproveddate day counts ──');
  [...bmDayRaw.entries()].sort().forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  console.log('\n── Raw BM April: dapproval1on day counts (what colleague may use) ──');
  [...d1DayRaw.entries()].sort().forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  const mismatch13 = rawBmApril.filter(
    (r) =>
      dayOnly(r.dapproval1on) === '13/04/2026' &&
      dayOnly(r.dbmapproveddate) &&
      dayOnly(r.dbmapproveddate) !== '13/04/2026'
  );
  console.log(`\n── Lines with dapproval1on=13-Apr but dbmapproveddate≠13-Apr: ${mismatch13.length}`);

  const excludeReasons = { no_category: 0, rejected: 0, no_bm_april: 0, wrong_office_type: 0 };
  for (const r of excluded.slice(0, 200)) {
    if (String(r.nofficetype) !== '3') excludeReasons.wrong_office_type++;
    else if (['1', 'true'].includes(String(r.breject).toLowerCase()) || ['1', 'true'].includes(String(r.brejectho).toLowerCase()))
      excludeReasons.rejected++;
    else if (!String(r.item_category_name ?? '').trim() && !(String(r.ntraveltype ?? '').trim() && String(r.ntraveltype) !== '0'))
      excludeReasons.no_category++;
    else excludeReasons.no_bm_april++;
  }
  console.log(`\n── Excluded from portal (${excluded.length} of raw BM April) sample reasons ──`);
  console.log(excludeReasons);

  const outDir = join(process.cwd(), 'exports');
  mkdirSync(outDir, { recursive: true });
  const headers = [
    'ncode',
    'vucnno',
    'vitemserialno',
    'nitemserialno',
    'dbmapproveddate',
    'dapproval1on',
    'nitemcategory',
    'item_category_name',
    'ntraveltype',
    'breject',
    'in_portal',
  ];
  const lines = [headers.join(',')];
  for (const r of rawBmApril) {
    lines.push(
      headers
        .map((h) => {
          if (h === 'in_portal') return portalNcodes.has(String(r.ncode)) ? 'yes' : 'no';
          return escapeCsvCell(r[h]);
        })
        .join(',')
    );
  }
  const path = join(outDir, `audit-arcp-raw-vs-portal_${startDate}_${endDate}_fr${franchisee}.csv`);
  writeFileSync(path, '\uFEFF' + lines.join('\r\n'), 'utf8');
  console.log(`\nWrote comparison: ${path}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
