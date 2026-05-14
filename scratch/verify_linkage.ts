
import { postQuery } from '../src/lib/db-proxy';

async function verifyLinkage() {
  const callCode = '26E111210';

  console.log(`--- Verifying Call ${callCode} ---`);

  const callRes = await postQuery({
    fields: "ncode, nofficeid, dtrndate",
    tableName: "trhcalls",
    condition: `vucnno = '${callCode}'`
  });

  if (!callRes.data?.[0]) {
    console.error("Call not found");
    return;
  }

  const call = callRes.data[0];
  console.log(`Call: ncode=${call.ncode}, office=${call.nofficeid}, date=${call.dtrndate}`);

  const visitsRes = await postQuery({
    fields: "ncalls, nofficeid, dvisitdatetime",
    tableName: "trdcalls1visit",
    condition: `ncalls = '${call.ncode}'`
  });

  console.log(`\nVisits for ncalls='${call.ncode}':`);
  visitsRes.data?.forEach((v: any) => {
    const isCorrect = v.nofficeid === call.nofficeid;
    console.log(`  - Date: ${v.dvisitdatetime}, Office: ${v.nofficeid} [${isCorrect ? 'MATCH' : 'WRONG OFFICE'}]`);
  });
}

verifyLinkage();
