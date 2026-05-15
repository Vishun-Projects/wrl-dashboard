const { postQuery } = require('../src/lib/db-proxy');
async function test() {
  try {
    const res = await postQuery({
      fields: 'TOP 5 callsolved, callstatus, Status, callsntrnno',
      tableName: 'uv_findtrhcalls_callsearch',
      condition: "officename LIKE '%INDORE%' AND callstatus != 'Cancel'"
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
