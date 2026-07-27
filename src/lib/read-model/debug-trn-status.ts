import '@/lib/read-model/bootstrap-env';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import { classifyRegisterRowStatus } from '@/lib/call-status/register-row';
import { prisma } from '@/lib/db/prisma';

const trn = process.argv[2];

if (!trn) {
  console.error('Usage: npx tsx src/lib/read-model/debug-trn-status.ts <TRN>');
  process.exit(1);
}

async function main() {
  const [crmRows, hotRows] = await Promise.all([
    fetchCrmRowsByTrns([trn], { includeTransferred: true }),
    prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
      `SELECT vtrnno, status_bucket, status_label, source_editedon, synced_at, ncancelreason,
              bsolved, bfastclose, region, account, serial, logged_at, solved_at, edited_at
       FROM calls_latest_hot
       WHERE vtrnno = $1`,
      trn
    ),
  ]);

  console.log('HOT ROW');
  console.log(JSON.stringify(hotRows[0] ?? null, null, 2));

  const crm = crmRows[0] ?? null;
  console.log('CRM ROW');
  console.log(
    JSON.stringify(
      crm
        ? {
            vtrnno: crm.vtrnno,
            Status: crm.Status,
            callstatus: crm.callstatus,
            bsolved: crm.bsolved,
            callsolved: crm.callsolved,
            bfastclose: crm.bfastclose,
            ncancelreason: crm.ncancelreason,
            dtrndate: crm.dtrndate,
            callsdtrndate: crm.callsdtrndate,
            dsolvedatetime: crm.dsolvedatetime,
            callsolveddate: crm.callsolveddate,
            editedon: crm.editedon,
            addedon: crm.addedon,
            serviceman: crm.serviceman,
            nengineer: crm.nengineer,
          }
        : null,
      null,
      2
    )
  );

  if (crm) {
    console.log('CLASSIFIED BUCKET', classifyRegisterRowStatus(crm));
    console.log('TRANSFORMED HOT');
    console.log(JSON.stringify(transformCrmRowToHot(crm), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
