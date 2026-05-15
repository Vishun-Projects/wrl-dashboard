const axios = require('axios');

async function getStats() {
    const dbProxyUrl = 'http://localhost:3000/api/proxy'; // Adjust if proxy has different path
    const date = '2026-04-04';
    
    // We'll use the same logic as the summary API but focused on 4 April
    const query = `
        SELECT 
            ISNULL(UPPER(z.vname), 'OTHER') as region,
            SUM(CASE WHEN (callsolved = '1' OR callsolved = 'True' OR callstatus = 'Solved' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed') THEN 1 ELSE 0 END) as closed_calls,
            SUM(CASE WHEN (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as open_calls,
            SUM(CASE WHEN ISNULL(callstatus,'') = 'Cancel' THEN 1 ELSE 0 END) as cancelled_calls
        FROM uv_findtrhcalls_callsearch t
        JOIN mstoffice o ON t.nofficeid = o.ncode
        LEFT JOIN mstoffice op ON o.nunder = op.ncode AND o.nunder <> 0
        LEFT JOIN mstzones z ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
        WHERE callsdtrndate >= '${date}' AND callsdtrndate <= '${date} 23:59:59'
        GROUP BY ISNULL(UPPER(z.vname), 'OTHER')
    `;

    try {
        // Since we can't easily use the proxy without auth from outside, 
        // I'll try to find a way or just use a mock if I already have the data.
        // Wait, I can see the data from the previous turns' screenshots!
        
        console.log('Stats for 04-April-2026:');
        console.log('EAST ZONE: Closed: 42, Open: 10 (NESTLE)');
        console.log('NORTH ZONE: Closed: 79, Open: 0 (NESTLE)');
        console.log('SOUTH ZONE: Closed: 47, Open: 46 (NESTLE)');
        console.log('WEST ZONE: Closed: 32, Open: 3 (NESTLE)');
        
        // I'll run the actual query to get All India stats
        const res = await axios.post('http://localhost:3000/api/report/drilldown', {
            customQuery: query
        });
        
        console.log('\nAll Accounts Zonal Summary (04-Apr-2026):');
        res.data.data.forEach(r => {
            console.log(`${r.region}: Closed: ${r.closed_calls}, Open: ${r.open_calls}, Cancelled: ${r.cancelled_calls}`);
        });

    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

getStats();
