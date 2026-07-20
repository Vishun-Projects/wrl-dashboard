import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';

async function main() {
  console.log('=== Checking July completed calls for Campa Cola ===');

  // Let's get the serials, dtrndate, and transaction upload date for July completed calls
  const res = await postQuery({
    rawSql: `
      SELECT tc.vserialno, tc.vtrnno, tc.dtrndate, tc.bsolved, tc.bfastclose, te.daddedon, te.Client
      FROM trhcalls tc (NOLOCK)
      INNER JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
      LEFT JOIN TransactionEntry te (NOLOCK) ON LTRIM(RTRIM(tc.vserialno)) = LTRIM(RTRIM(te.ProductSerialNo))
      WHERE pprof.vname = 'Reliance Campa Cola'
        AND tc.dtrndate >= '2026-07-01' AND tc.dtrndate <= '2026-07-20 23:59:59'
        AND (tc.bsolved = 'True' OR tc.bfastclose = 'True')
    `
  });
  console.log('July completed calls with their CRM upload dates:', res.data);
}

main().catch(console.error);
