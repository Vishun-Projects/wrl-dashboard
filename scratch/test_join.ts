import axios from 'axios';

async function testJoin() {
  const payload = {
    fields: "TOP 5 p.ncalls, p.nitem, i.vname as item_name",
    tableName: "trdcalls3parts p LEFT JOIN mstitems i ON p.nitem = i.ncode",
    condition: "1=1"
  };

  try {
    const res = await axios.post('http://localhost:3000/api/proxy', payload);
    console.log('Join Result:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Error:', err.response?.data || err.message);
  }
}

testJoin();
