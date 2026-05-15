
import { postQuery } from '../src/lib/db-proxy';

async function run() {
    try {
        const res = await postQuery({ 
            fields: 'callstatus, COUNT(*) as cnt', 
            tableName: 'uv_findtrhcalls_callsearch',
            condition: '1=1 GROUP BY callstatus' 
        });
        console.log('Statuses:', res.data);
    } catch (e) {
        console.error(e);
    }
}
run();
