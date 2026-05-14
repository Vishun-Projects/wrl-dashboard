
const axios = require('axios');

async function checkColumns() {
  try {
    const res = await axios.post('http://10.100.85.64:3001/query', {
      query: "SELECT TOP 1 * FROM trdcalls1visit (NOLOCK)"
    });
    console.log("trdcalls1visit columns:", Object.keys(res.data[0]));

    const res2 = await axios.post('http://10.100.85.64:3001/query', {
      query: "SELECT TOP 1 * FROM trdcalls3parts (NOLOCK)"
    });
    console.log("trdcalls3parts columns:", Object.keys(res2.data[0]));
  } catch (e) {
    console.error("Error:", e.message);
  }
}

checkColumns();
