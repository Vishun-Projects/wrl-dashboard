import { postQuery } from '../src/lib/db-proxy';

async function run() {
  try {
    console.log("1. Querying column info for callsntrnno and ncancelreason in uv_findtrhcalls_callsearch...");
    const cols = await postQuery({
      fields: "COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH",
      tableName: "INFORMATION_SCHEMA.COLUMNS",
      condition: "TABLE_NAME = 'uv_findtrhcalls_callsearch' AND COLUMN_NAME IN ('callsntrnno', 'ncancelreason')"
    });
    console.log("Columns:", JSON.stringify(cols.data, null, 2));

    console.log("2. Querying 5 rows from uv_findtrhcalls_callsearch...");
    const sample = await postQuery({
      top: "5",
      fields: "callsntrnno, ncancelreason, PartyName",
      tableName: "uv_findtrhcalls_callsearch (NOLOCK)"
    });
    console.log("Sample rows:", JSON.stringify(sample.data, null, 2));

    console.log("3. Querying status and remarks fields for UniqueCallNo = '26D23748'...");
    const specific = await postQuery({
      fields: "callsntrnno, ncancelreason, Status, callstatus, callsolved, bfastclose, bmreject, horeject, rejectionstatus, vsolveremarks, vcomment",
      tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
      condition: "UniqueCallNo = '26D23748'"
    });
    console.log("Matched row status details:", JSON.stringify(specific.data, null, 2));

  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

run();
