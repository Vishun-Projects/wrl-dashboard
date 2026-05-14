const { postQuery } = require('./src/lib/db-proxy');

async function checkMajorRepairs() {
  try {
    const res = await postQuery({
      fields: "ncode, vname, bmajor",
      tableName: "mstrepair (NOLOCK)",
      condition: "bmajor = 'True'"
    });
    console.log("Major Repairs:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

checkMajorRepairs();
