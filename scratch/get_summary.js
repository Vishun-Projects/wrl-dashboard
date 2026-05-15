const axios = require('axios');

async function getSummary() {
    try {
        const date = '2026-04-04';
        const res = await axios.get(`http://localhost:3000/api/report/summary?startDate=${date}&endDate=${date}`);
        const branches = res.data.branchSummary;
        
        const zones = {
            'EAST': { total: 0, solved: 0, open: 0, cancelled: 0 },
            'WEST': { total: 0, solved: 0, open: 0, cancelled: 0 },
            'NORTH': { total: 0, solved: 0, open: 0, cancelled: 0 },
            'SOUTH': { total: 0, solved: 0, open: 0, cancelled: 0 }
        };

        branches.forEach(b => {
            const z = b.zone;
            if (zones[z]) {
                zones[z].total += b.total_calls;
                zones[z].solved += b.total_solved;
                zones[z].open += b.open_calls;
                zones[z].cancelled += b.cancelled_calls;
            }
        });

        console.log('Zonal Summary for 04-04-2026 (All Accounts):');
        Object.entries(zones).forEach(([name, stats]) => {
            console.log(`${name} ZONE:`);
            console.log(`  Total Calls: ${stats.total}`);
            console.log(`  Closed (Solved): ${stats.solved}`);
            console.log(`  Cancelled: ${stats.cancelled}`);
            console.log(`  Open Calls: ${stats.open}`);
        });
    } catch (err) {
        console.error('Error:', err.message);
    }
}

getSummary();
