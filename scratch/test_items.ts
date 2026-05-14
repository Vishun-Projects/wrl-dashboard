
import { postQuery } from '../src/lib/db-proxy';

async function testMstItems() {
  try {
    const res = await postQuery({
      top: '5',
      fields: "ncode, vname",
      tableName: "mstitems"
    });
    console.log("MSTITEMS Result:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("MSTITEMS Failed, trying MSTITEM");
    try {
      const res = await postQuery({
        top: '5',
        fields: "ncode, vname",
        tableName: "mstitem"
      });
      console.log("MSTITEM Result:", JSON.stringify(res.data, null, 2));
    } catch (err2) {
      console.error("Both failed");
    }
  }
}

testMstItems();
