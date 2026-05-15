import { postQuery } from './src/lib/db-proxy';

async function main() {
  const query = `
    SELECT callsntrnno, callsdtrndate, TRY_CAST(callsdtrndate AS DATETIME) as parsed
    FROM uv_findtrhcalls_callsearch (NOLOCK) 
    WHERE callsntrnno IN ('3371', '30360', '30359', '3378', '30358', '3375', '30357')
  `;
  const res = await postQuery({ rawSql: query });
  console.log(res);
}

main().catch(console.error);
