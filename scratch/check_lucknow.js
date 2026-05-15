const { postQuery } = require('../src/lib/db-proxy');
async function test() {
  try {
    const res = await postQuery({
      fields: 'TOP 5 Status, callstatus, callsolved, callsntrnno',
      tableName: 'uv_findtrhcalls_callsearch',
      condition: "officename LIKE '%LUCKNOW%' AND (callsolved = 'True' OR callsolved = '1' OR callstatus = 'Solved' OR Status = 'Closed')"
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
