import { postQuery } from './src/lib/db-proxy';

async function main() {
  const query = `SELECT TOP 5 callsntrnno, callsdtrndate FROM uv_findtrhcalls_callsearch (NOLOCK) ORDER BY callsdtrndate DESC`;
  const res = await postQuery({ rawSql: query });
  console.log('Latest 5 records based on string DESC:');
  console.log(res);

  const query2 = `SELECT TOP 5 callsntrnno, callsdtrndate FROM uv_findtrhcalls_callsearch (NOLOCK) ORDER BY ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) DESC`;
  const res2 = await postQuery({ rawSql: query2 });
  console.log('\nLatest 5 records based on parsed datetime DESC:');
  console.log(res2);
  
  const query3 = `
    SELECT TOP 5 callsntrnno, callsdtrndate, 
           TRY_CAST(callsdtrndate AS DATETIME) as casted,
           TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104) as converted104,
           TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 103) as converted103
    FROM uv_findtrhcalls_callsearch (NOLOCK) 
    WHERE callsntrnno IN ('3371', '30360')
  `;
  const res3 = await postQuery({ rawSql: query3 });
  console.log('\nSpecific records parsed dates:');
  console.log(res3);
}

main().catch(console.error);
