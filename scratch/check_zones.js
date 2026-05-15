const { postQuery } = require('../src/lib/db-proxy');
async function test() {
  try {
    const res = await postQuery({
      fields: 'officename, nzone',
      tableName: 'mstoffice',
      condition: "officename LIKE '%LUCKNOW%' OR officename LIKE '%MUMBAI%' OR officename LIKE '%CHENNAI%' OR officename LIKE '%KOLKATA%'"
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
