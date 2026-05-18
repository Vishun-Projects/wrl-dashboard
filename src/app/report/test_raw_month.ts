import { postQuery } from '../../lib/db-proxy';

async function main() {
  console.log("Checking trhcalls counts...");

  // 1. Last 30 Days (2026-04-18 to 2026-05-18)
  const count30Days = await postQuery({
    fields: "COUNT(*) as total_all, COUNT(DISTINCT vtrnno) as total_unique",
    tableName: "trhcalls tc (NOLOCK)",
    condition: "tc.vtrnno IS NOT NULL AND tc.vtrnno <> '' AND tc.dtrndate >= '2026-04-18'"
  });

  // 2. May 2026 Month (2026-05-01 to 2026-05-31)
  const countMay = await postQuery({
    fields: "COUNT(*) as total_all, COUNT(DISTINCT vtrnno) as total_unique",
    tableName: "trhcalls tc (NOLOCK)",
    condition: "tc.vtrnno IS NOT NULL AND tc.vtrnno <> '' AND tc.dtrndate >= '2026-05-01' AND tc.dtrndate <= '2026-05-31 23:59:59'"
  });

  // 3. April 2026 Month (2026-04-01 to 2026-04-30)
  const countApril = await postQuery({
    fields: "COUNT(*) as total_all, COUNT(DISTINCT vtrnno) as total_unique",
    tableName: "trhcalls tc (NOLOCK)",
    condition: "tc.vtrnno IS NOT NULL AND tc.vtrnno <> '' AND tc.dtrndate >= '2026-04-01' AND tc.dtrndate <= '2026-04-30 23:59:59'"
  });

  console.log('\n--- 1. Last 30 Days (April 18 to May 18) ---');
  console.log('ALL Records:   ', count30Days.data?.[0]?.total_all);
  console.log('Unique Records:', count30Days.data?.[0]?.total_unique);

  console.log('\n--- 2. May 2026 ---');
  console.log('ALL Records:   ', countMay.data?.[0]?.total_all);
  console.log('Unique Records:', countMay.data?.[0]?.total_unique);

  console.log('\n--- 3. April 2026 ---');
  console.log('ALL Records:   ', countApril.data?.[0]?.total_all);
  console.log('Unique Records:', countApril.data?.[0]?.total_unique);
}

main().catch(console.error);
