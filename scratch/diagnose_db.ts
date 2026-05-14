import { postQuery } from '../src/lib/db-proxy';

async function diagnose() {
  try {
    console.log("Checking distinct statuses...");
    const statuses = await postQuery({
      fields: "DISTINCT callStatus",
      tableName: "trhcalls",
      condition: "1=1"
    });
    console.log("Statuses:", statuses.data);

    console.log("\nChecking distinct priorities...");
    const priorities = await postQuery({
      fields: "DISTINCT npriority",
      tableName: "trhcalls",
      condition: "1=1"
    });
    console.log("Priorities:", priorities.data);

    const targetCondition = "tc.bsolved = 'False' AND (tc.nengineer IS NULL OR tc.nengineer = 0) AND (tc.npriority = '879' OR tc.npriority = '1') AND tc.dtrndate >= DATEADD(day, -90, GETDATE())";
    console.log(`\nCounting records for: ${targetCondition}`);
    const count = await postQuery({
      fields: "COUNT(*) as total",
      tableName: "trhcalls tc",
      condition: targetCondition
    });
    console.log("Result count:", count.data);

    const conditionNoPrio = "tc.bsolved = 'False' AND (tc.nengineer IS NULL OR tc.nengineer = 0) AND tc.dtrndate >= DATEADD(day, -90, GETDATE())";
    console.log(`\nCounting records (No Priority Filter): ${conditionNoPrio}`);
    const countNoPrio = await postQuery({
      fields: "COUNT(*) as total",
      tableName: "trhcalls tc",
      condition: conditionNoPrio
    });
    console.log("Result count (No Priority):", countNoPrio.data);

  } catch (err) {
    console.error("Diagnosis failed:", err);
  }
}

diagnose();
