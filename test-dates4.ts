import { postQuery } from './src/lib/db-proxy';

async function main() {
  const query = `
    SELECT callsntrnno, callsdtrndate
    FROM uv_findtrhcalls_callsearch (NOLOCK) 
    WHERE callsntrnno = '30360'
  `;
  const res = await postQuery({ rawSql: query });
  console.log('Record 30360:');
  console.log(res);
}

main().catch(console.error);
