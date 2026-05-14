
import axios from 'axios';

const PROXY_URL = 'http://localhost:5000/query';

async function query(sql: string) {
    try {
        const response = await axios.post(PROXY_URL, { sql });
        return response.data;
    } catch (error) {
        console.error('Query failed:', sql);
        return [];
    }
}

async function main() {
    console.log('--- Checking for Cancel Reason Tables ---');
    
    // Check common master tables
    const tables = [
        'mstcancelreason',
        'mstcancelreasons',
        'mstreason',
        'mstreasons',
        'mstcallcancelreason',
        'mstcallcancelreasons'
    ];

    for (const table of tables) {
        console.log(`Checking ${table}...`);
        const res = await query(`SELECT TOP 5 * FROM ${table}`);
        if (res.length > 0) {
            console.log(`FOUND ${table}:`, res);
        }
    }

    console.log('--- Checking trhcalls sample with ncancelreason ---');
    const calls = await query("SELECT TOP 5 ncancelreason FROM trhcalls WHERE ncancelreason IS NOT NULL AND ncancelreason <> ''");
    console.log('Sample ncancelreason values:', calls);
}

main();
