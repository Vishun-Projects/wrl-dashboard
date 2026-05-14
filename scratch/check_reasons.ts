
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
    console.log('--- Checking mstcallcancelreasons contents ---');
    const res = await query("SELECT ncode, vname FROM mstcallcancelreasons");
    console.log('Reasons:', res);
}

main();
