const axios = require('axios');
async function test() {
    const res = await axios.get('http://localhost:3000/api/report/summary?startDate=2026-04-04&endDate=2026-04-04');
    console.log(Object.keys(res.data));
    if (res.data.branchSummary) console.log('Branch Summary Length:', res.data.branchSummary.length);
}
test();
