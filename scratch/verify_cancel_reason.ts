
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
    console.log('--- Verifying Cancel Reason Join ---');
    const sql = `
        SELECT TOP 5 
            tc.vucnno, 
            tc.ncancelreason as raw_reason_id,
            cr.vname as reason_name
        FROM trhcalls tc
        LEFT JOIN mstcallcancelreasons cr ON CAST(tc.ncancelreason AS VARCHAR) = CAST(cr.ncode AS VARCHAR)
        WHERE tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> ''
    `;
    const res = await query(sql);
    console.log('Results:', res);
}

main();
