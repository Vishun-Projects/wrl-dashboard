import { postQuery } from '../src/lib/db-proxy';

async function run() {
  try {
    // Find where vinsttel1 lives
    console.log("Finding vinsttel1 table...");
    const r1 = await postQuery({ fields: 'TABLE_NAME, COLUMN_NAME', tableName: 'INFORMATION_SCHEMA.COLUMNS', condition: "COLUMN_NAME = 'vinsttel1'", orderBy: 'TABLE_NAME' });
    console.log("vinsttel1 tables:", JSON.stringify(r1.data));

    // Find item/product master
    console.log("\nFinding item/product table...");
    const r2 = await postQuery({ top: "10", fields: 'TABLE_NAME', tableName: 'INFORMATION_SCHEMA.TABLES', condition: "TABLE_TYPE='BASE TABLE' AND (TABLE_NAME LIKE 'mstproduct%' OR TABLE_NAME LIKE 'mstitem%' OR TABLE_NAME LIKE 'mst%item%')" });
    console.log("product/item tables:", JSON.stringify(r2.data));

    // Check mstproducts
    console.log("\nChecking mstproducts...");
    const r3 = await postQuery({ top: "1", fields: "ncode, vname", tableName: "mstproducts (NOLOCK)", condition: "1=1" });
    console.log("mstproducts:", JSON.stringify(r3.data));

  } catch (err: any) {
    console.error("Error:", err.message.substring(0, 200));
  }
}
run();
