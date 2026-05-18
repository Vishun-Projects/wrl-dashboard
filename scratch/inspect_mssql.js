const { postQuery } = require('../src/lib/db-proxy');

async function run() {
  try {
    console.log("1. Finding a sample call by vtrnno in trhcalls...");
    const sampleTrh = await postQuery({
      top: "1",
      fields: "ncode, vtrnno, callsntrnno, ncancelreason, callStatus, bsolved, bfastclose",
      tableName: "trhcalls (NOLOCK)",
      condition: "vtrnno IS NOT NULL AND vtrnno <> ''"
    });
    console.log("Sample from trhcalls:", JSON.stringify(sampleTrh.data, null, 2));

    console.log("2. Querying a specific code like 26D23748 or 26D-23-748 in trhcalls...");
    const specTrh = await postQuery({
      fields: "ncode, vtrnno, callsntrnno, ncancelreason, callStatus, bsolved, bfastclose",
      tableName: "trhcalls (NOLOCK)",
      condition: "vtrnno = '26D-23-748' OR vtrnno = '26D23748' OR callsntrnno = '26D-23-748' OR callsntrnno = '26D23748'"
    });
    console.log("Spec from trhcalls:", JSON.stringify(specTrh.data, null, 2));

    console.log("3. Querying uv_findtrhcalls_callsearch with vtrnno = '26D-23-748' or callsntrnno = '26D-23-748'...");
    try {
      const specUv = await postQuery({
        fields: "callsntrnno, PartyName, vcomplaint",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition: "callsntrnno = '26D-23-748' OR callsntrnno = '26D23748'"
      });
      console.log("Spec from uv_findtrhcalls_callsearch:", JSON.stringify(specUv.data, null, 2));
    } catch (err: any) {
      console.error("uv query failed:", err.message);
    }
  } catch (err) {
    console.error("FAILED:", err.message);
  }
}

run();
