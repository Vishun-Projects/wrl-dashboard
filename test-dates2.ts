import { postQuery } from './src/lib/db-proxy';

async function main() {
  const query3 = `
    SELECT TOP 5 callsntrnno, callsdtrndate
    FROM uv_findtrhcalls_callsearch (NOLOCK) 
    WHERE callsntrnno IN ('3371', '30360', '30359', '3378', '30358')
    AND callsdtrndate LIKE '%2026%'
  `;
  const res3 = await postQuery({ rawSql: query3 });
  console.log('\nSpecific records parsed dates:');
  console.log(res3);
}

main().catch(console.error);
