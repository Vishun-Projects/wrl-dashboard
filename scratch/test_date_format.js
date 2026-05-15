const axios = require('axios');

async function testDate() {
    const query = `
        SELECT TOP 5
            callsdtrndate,
            TRY_CAST(callsdtrndate AS DATETIME) as try_cast_val,
            TRY_CONVERT(DATETIME, CAST(callsdtrndate AS NVARCHAR(50))) as try_convert_val
        FROM uv_findtrhcalls_callsearch
        WHERE callsdtrndate IS NOT NULL
    `;




    try {
        const res = await axios.post('http://localhost:3000/api/report/drilldown', {
            customQuery: query
        });
        console.log('Response Data:', JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

testDate();
