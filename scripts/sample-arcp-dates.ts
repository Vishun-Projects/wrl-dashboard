import { postQuery } from '../src/lib/db-proxy';

async function main() {
  const rawSql = `
SELECT TOP 8
  ncode,
  dapproval1on,
  dapproval2on,
  addedon,
  dbmapproveddate,
  dhoapproveddate,
  nchargespayable
FROM trdcalls10ARCP (NOLOCK)
WHERE nofficetype = '3'
  AND dhoapproveddate >= '2025-01-01'
  AND dhoapproveddate <= '2025-12-31 23:59:59'
ORDER BY dhoapproveddate
`;

  const res = await postQuery({ rawSql, timeoutMs: 120000 });
  console.log(JSON.stringify(res.data, null, 2));
}

main().catch(console.error);
