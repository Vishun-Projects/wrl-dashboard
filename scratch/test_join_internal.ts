import { postQuery } from '../src/lib/db-proxy';

async function testJoin() {
  try {
    const res = await postQuery({
      fields: "TOP 5 p.ncalls, i.vname as item_name",
      tableName: "trdcalls3parts p LEFT JOIN mstitems i ON p.nitem = i.ncode",
      condition: "1=1"
    });
    console.log('Join Result:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Join failed:', err.message);
  }
}

testJoin();
