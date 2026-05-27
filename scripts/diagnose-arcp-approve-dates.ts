import { postQuery } from '../src/lib/db-proxy';

const startDate = process.argv[2] || '2025-01-01';
const endDate = process.argv[3] || '2025-12-31';
const endTs = `${endDate} 23:59:59`;

async function count(label: string, extraWhere: string) {
  const rawSql = `
SELECT COUNT(DISTINCT arcp.ncode) AS qty,
  SUM(TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(arcp.nchargespayable AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT)) AS amount_payable
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN mstitemcategory ic (NOLOCK)
  ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
WHERE arcp.nofficetype = '3'
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND COALESCE(NULLIF(LTRIM(RTRIM(ic.vname)), ''), NULLIF(LTRIM(RTRIM(ic.vshortname)), '')) IS NOT NULL
    )
  )
  AND (${extraWhere})
`;
  const res = await postQuery({ rawSql, timeoutMs: 180000 });
  console.log(label, (res.data || [])[0]);
}

async function main() {
  console.log(`Approve-date diagnostics ${startDate} → ${endDate}\n`);

  await count('A) OR: any of dapproval1on / dapproval2on / addedon in range', `
    (arcp.dapproval1on >= '${startDate}' AND arcp.dapproval1on <= '${endTs}')
    OR (arcp.dapproval2on >= '${startDate}' AND arcp.dapproval2on <= '${endTs}')
    OR (arcp.addedon >= '${startDate}' AND arcp.addedon <= '${endTs}')
  `);

  await count('B) COALESCE(dapproval2on, dapproval1on, addedon) in range', `
    COALESCE(
      NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval2on AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.addedon AS VARCHAR(30)))), '')
    ) >= '${startDate}'
    AND COALESCE(
      NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval2on AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.dapproval1on AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.addedon AS VARCHAR(30)))), '')
    ) <= '${endTs}'
  `);

  await count('C) COALESCE(dhoapproveddate, dbmapproveddate, addedon) in range', `
    COALESCE(
      NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.addedon AS VARCHAR(30)))), '')
    ) >= '${startDate}'
    AND COALESCE(
      NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), ''),
      NULLIF(LTRIM(RTRIM(CAST(arcp.addedon AS VARCHAR(30)))), '')
    ) <= '${endTs}'
  `);

  await count('D) dhoapproveddate in range only', `
    arcp.dhoapproveddate >= '${startDate}' AND arcp.dhoapproveddate <= '${endTs}'
  `);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
