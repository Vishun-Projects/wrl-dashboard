import { postQuery } from '../src/lib/db-proxy.js';

const startDate = process.argv[2] || '2026-04-30';
const endDate = process.argv[3] || '2026-05-25';

const rawSql = `
  SELECT
    SUM(CASE WHEN is_major = 1 THEN 1 ELSE 0 END) AS major_count,
    SUM(CASE WHEN is_major = 0 THEN 1 ELSE 0 END) AS minor_count,
    COUNT(*) AS total
  FROM (
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM trdcalls2fault tf (NOLOCK)
        JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
        WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True'
      ) THEN 1 ELSE 0 END AS is_major
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
          ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
        ) AS rn
      FROM trhcalls (NOLOCK)
      WHERE dtrndate >= '${startDate}' AND dtrndate <= '${endDate} 23:59:59'
    ) tc
    WHERE tc.rn = 1
      AND tc.vtrnno IS NOT NULL AND tc.vtrnno <> ''
      AND ISNULL(tc.vtransfercallno, '') = ''
      AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2
  ) x
`;

const res = await postQuery({ rawSql, timeoutMs: 120000 });
console.log(JSON.stringify(res.data?.[0] ?? res, null, 2));
