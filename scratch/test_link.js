
const axios = require('axios');

async function testTicket() {
  try {
    // 1. Find the internal ncode for this reference
    const ref = '26E021507';
    const res = await axios.post('http://10.100.85.64:3001/query', {
      query: `SELECT TOP 1 ncode, vtrnno FROM trhcalls (NOLOCK) WHERE vtrnno LIKE '%${ref}%'`
    });
    
    if (!res.data || res.data.length === 0) {
      console.log("Ticket not found in trhcalls");
      return;
    }

    const { ncode, vtrnno } = res.data[0];
    console.log(`Ticket Found: ncode=${ncode}, vtrnno=${vtrnno}`);

    // 2. Check visits using ncode
    const resVisitsNcode = await axios.post('http://10.100.85.64:3001/query', {
      query: `SELECT COUNT(*) as cnt FROM trdcalls1visit (NOLOCK) WHERE ncalls = '${ncode}'`
    });
    console.log(`Visits found using ncode: ${resVisitsNcode.data[0].cnt}`);

    // 3. Check visits using vtrnno
    const resVisitsRef = await axios.post('http://10.100.85.64:3001/query', {
      query: `SELECT COUNT(*) as cnt FROM trdcalls1visit (NOLOCK) WHERE ncalls = '${vtrnno}'`
    });
    console.log(`Visits found using vtrnno: ${resVisitsRef.data[0].cnt}`);

  } catch (e) {
    console.error("Error:", e.message);
  }
}

testTicket();
