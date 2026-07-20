import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import { postQuery } from '@/lib/db/proxy';

async function main() {
  console.log('=== Checking live CRM calls for Campa Cola in July 2026 ===');

  // Let's count calls in trhcalls for Campa Cola by date
  const res = await postQuery({
    rawSql: `
      SELECT COUNT(*) as cnt
      FROM trhcalls tc (NOLOCK)
      INNER JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
      INNER JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
      WHERE pprof.vname = 'Reliance Campa Cola'
        AND tc.dtrndate >= '2026-07-01' AND tc.dtrndate <= '2026-07-20 23:59:59'
    `
  });
  console.log('Live CRM calls for Campa Cola in July:', res.data);

  // Let's also check all-time calls count in trhcalls for Campa Cola
  const allTimeRes = await postQuery({
    rawSql: `
      SELECT COUNT(*) as cnt
      FROM trhcalls tc (NOLOCK)
      INNER JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
      WHERE pprof.vname = 'Reliance Campa Cola'
    `
  });
  console.log('Live CRM calls for Campa Cola all-time:', allTimeRes.data);

  // Check how many have bsolved = 1 or bfastclose = 1
  const solvedRes = await postQuery({
    rawSql: `
      SELECT tc.bsolved, tc.bfastclose, COUNT(*) as cnt
      FROM trhcalls tc (NOLOCK)
      INNER JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
      WHERE pprof.vname = 'Reliance Campa Cola'
        AND tc.dtrndate >= '2026-07-01' AND tc.dtrndate <= '2026-07-20 23:59:59'
      GROUP BY tc.bsolved, tc.bfastclose
    `
  });
  console.log('Live CRM July call status counts:', solvedRes.data);
}

main().catch(console.error);
