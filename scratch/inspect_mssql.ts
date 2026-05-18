import { postQuery } from '../src/lib/db-proxy';

async function run() {
  try {
    console.log("1. Finding a sample call by vtrnno in trhcalls...");
    const sampleTrh = await postQuery({
      top: "1",
      fields: "ncode, vtrnno, ntrnno, ncancelreason, bsolved, bfastclose",
      tableName: "trhcalls (NOLOCK)",
      condition: "vtrnno IS NOT NULL AND vtrnno <> ''"
    });
    console.log("Sample from trhcalls:", JSON.stringify(sampleTrh.data, null, 2));

    console.log("2. Querying a specific code like 26D23748 or 26D-23-748 in trhcalls...");
    const specTrh = await postQuery({
      fields: "ncode, vtrnno, ntrnno, ncancelreason, bsolved, bfastclose",
      tableName: "trhcalls (NOLOCK)",
      condition: "vtrnno = '26D-23-748' OR vtrnno = '26D23748'"
    });
    console.log("Spec from trhcalls:", JSON.stringify(specTrh.data, null, 2));

    console.log("3. Fetching view definition for uv_findtrhcalls_callsearch...");
    try {
      const viewDef = await postQuery({
        fields: "definition",
        tableName: "sys.sql_modules",
        condition: "object_id = OBJECT_ID('uv_findtrhcalls_callsearch')"
      });
      console.log("View definition:", viewDef.data?.[0]?.definition);
    } catch (err: any) {
      console.error("View definition query failed:", err.message);
    }

    console.log("4. Fetching columns for uv_findtrhcalls_callsearch...");
    try {
      const columns = await postQuery({
        fields: "COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH",
        tableName: "INFORMATION_SCHEMA.COLUMNS",
        condition: "TABLE_NAME = 'uv_findtrhcalls_callsearch'",
        orderBy: "ORDINAL_POSITION"
      });
      console.log("Columns of uv_findtrhcalls_callsearch:", JSON.stringify(columns.data, null, 2));
    } catch (err: any) {
      console.error("Columns query failed:", err.message);
    }
  } catch (err: any) {
    console.error("FAILED:", err.message);
  }
}

run();
