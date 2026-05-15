
const { postQuery } = require('../src/lib/db-proxy');
async function run() {
    try {
        const res1 = await postQuery({ fields: 'DISTINCT callstatus', tableName: 'uv_findtrhcalls_callsearch' });
        console.log('CallStatus:', res1.data);
        const res2 = await postQuery({ fields: 'DISTINCT CAST(Status AS NVARCHAR(MAX)) as st', tableName: 'uv_findtrhcalls_callsearch' });
        console.log('StatusField:', res2.data);
    } catch (e) {
        console.error(e);
    }
}
run();
