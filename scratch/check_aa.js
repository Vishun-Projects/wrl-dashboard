const { postQuery } = require('../src/lib/db-proxy');
async function test() {
  try {
    const res = await postQuery({
      fields: 'TOP 5 Status, callstatus, callsolved, officename',
      tableName: 'uv_findtrhcalls_callsearch',
      condition: "officename LIKE '%A AND A TRADING%'"
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
