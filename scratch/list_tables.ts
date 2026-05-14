
import axios from 'axios';

const PROXY_URL = 'http://localhost:5000/query';

async function query(sql: string) {
    try {
        const response = await axios.post(PROXY_URL, { sql });
        return response.data;
    } catch (error) {
        // console.error('Query failed:', sql);
        return null;
    }
}

async function main() {
    console.log('--- Listing all tables ---');
    const res = await query("SELECT name FROM sys.tables ORDER BY name");
    if (res) {
        console.log('Tables found:', res.map((t: any) => t.name).filter((n: string) => n.toLowerCase().includes('reason') || n.toLowerCase().includes('cancel')));
    } else {
        console.log('Failed to fetch tables.');
    }
}

main();
