import { postQuery } from './src/lib/db-proxy';

async function main() {
  console.log("Querying calls using composite primary key join...");
  const result = await postQuery({
    rawSql: `
SELECT 
    COUNT(*) as [Total Calls],
    SUM(CASE WHEN tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed' THEN 1 ELSE 0 END) as [Solved],
    SUM(CASE WHEN (tc.bsolved = 0 OR tc.bsolved IS NULL) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as [Open],
    SUM(CASE WHEN ISNULL(tc.vtransfercallno, '') <> '' OR tc.ncancelreason = 2 THEN 1 ELSE 0 END) as [Transferred],
    SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as [Cancelled]
FROM trhcalls tc (NOLOCK)
JOIN (
    SELECT ncode, nofficeid, ROW_NUMBER() OVER (PARTITION BY vtrnno ORDER BY vtrnno ORDER BY ncode DESC) as rn -- wait, ROW_NUMBER() OVER (PARTITION BY vtrnno ORDER BY ncode DESC)
    FROM trhcalls (NOLOCK)
    WHERE vtrnno IS NOT NULL AND vtrnno <> ''
) latest_c ON tc.ncode = latest_c.ncode AND tc.nofficeid = latest_c.nofficeid
WHERE latest_c.rn = 1
    `.replace('PARTITION BY vtrnno ORDER BY vtrnno ORDER BY ncode DESC', 'PARTITION BY vtrnno ORDER BY ncode DESC') // Fix the typo before it runs
  });
  console.log('Result:', result.data);
}

main().catch(console.error);
