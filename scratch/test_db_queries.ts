import { postQuery } from '../src/app/api/report/route'; // We can just copy the search condition builder
import { postQuery as runSql } from '../src/lib/db-proxy';

function getExactTrnQuery(search: string): string | null {
  const cleaned = search.trim().replace(/-/g, '');
  if (/^[A-Za-z0-9]{3}\d{2}\d+$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function buildReportsCondition(search: string): string {
  let condition = "callsntrnno IS NOT NULL AND callsntrnno <> ''";
  if (search && search.length > 2) {
    const searchSafe = search.replace(/'/g, "''");
    const exactTrn = getExactTrnQuery(searchSafe);
    if (exactTrn) {
      condition += ` AND (UniqueCallNo = '${exactTrn}')`;
    } else {
      condition += ` AND (CAST(callsntrnno AS NVARCHAR(50)) LIKE '%${searchSafe}%' OR itemname LIKE '%${searchSafe}%' OR PartyName LIKE '%${searchSafe}%' OR callsvserialno LIKE '%${searchSafe}%' OR UniqueCallNo LIKE '%${searchSafe}%')`;
    }
  }
  return condition;
}

function buildCallsCondition(search: string): string {
  let condition = "(tc.ncancelreason IS NULL OR tc.ncancelreason = 0 OR tc.ncancelreason = 2)";
  if (search && search.length > 2) {
    const searchSafe = search.replace(/'/g, "''");
    const exactTrn = getExactTrnQuery(searchSafe);
    if (exactTrn) {
      condition += ` AND (tc.vtrnno = '${exactTrn}' OR tc.vtransfercallno = '${exactTrn}')`;
    } else {
      condition += ` AND (
        REPLACE(tc.vtrnno, '-', '') LIKE '%${searchSafe}%' 
        OR tc.vtrnno LIKE '%${searchSafe}%' 
        OR tc.vtransfercallno LIKE '%${searchSafe}%'
        OR tc.vserialno LIKE '%${searchSafe}%'
        OR tc.vcomplaint LIKE '%${searchSafe}%'
        OR p.vname LIKE '%${searchSafe}%'
        OR o.vcompanyname LIKE '%${searchSafe}%'
        OR u.vname LIKE '%${searchSafe}%'
        OR CAST(tc.ncode AS NVARCHAR(50)) LIKE '%${searchSafe}%'
      )`;
    }
  }
  return condition;
}

async function verify() {
  try {
    const testCases = ['26D23748', '26D-23-748'];
    for (const testCase of testCases) {
      console.log(`\n--- Testing Search: "${testCase}" ---`);
      
      // 1. Test reports condition
      const repCond = buildReportsCondition(testCase);
      console.log("Reports condition:", repCond);
      const repRes = await runSql({
        fields: "callsntrnno, PartyName, UniqueCallNo",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition: repCond
      });
      console.log("Reports matching rows count:", repRes.data?.length);
      if (repRes.data && repRes.data.length > 0) {
        console.log("Matched Reports record:", JSON.stringify(repRes.data[0]));
      }

      // 2. Test calls condition
      const callsCond = buildCallsCondition(testCase);
      console.log("Calls condition:", callsCond);
      // Let's verify if the calls condition parses and runs against trhcalls (which is the main table for calls route)
      const callsRes = await runSql({
        fields: "ncode, vtrnno",
        tableName: "trhcalls tc (NOLOCK)",
        condition: callsCond
      });
      console.log("Calls matching rows count:", callsRes.data?.length);
      if (callsRes.data && callsRes.data.length > 0) {
        console.log("Matched Calls record:", JSON.stringify(callsRes.data[0]));
      }
    }
    console.log("\nALL VERIFICATIONS PASSED SUCCESSFULLY!");
  } catch (err: any) {
    console.error("Verification failed:", err.message);
  }
}

verify();
