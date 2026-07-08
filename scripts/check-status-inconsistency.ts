/**
 * Quick internal status consistency checks on calls_latest_hot (YTD).
 * Usage: npx tsx scripts/check-status-inconsistency.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import '@/lib/read-model/bootstrap-env';
import { withAppClient, closePool } from '@/lib/read-model/db';

const CHECKS: Array<{ label: string; sql: string }> = [
  {
    label: 'open/assigned but solved_at set',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket IN ('open_unallocated','assigned') AND solved_at IS NOT NULL`,
  },
  {
    label: 'open/assigned but bsolved=true',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket IN ('open_unallocated','assigned') AND bsolved = true`,
  },
  {
    label: 'open/assigned but bfastclose=true',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket IN ('open_unallocated','assigned') AND bfastclose = true`,
  },
  {
    label: 'tech_solved but bfastclose=false',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket = 'tech_solved' AND coalesce(bfastclose, false) = false`,
  },
  {
    label: 'solved but bsolved=false',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket = 'solved' AND coalesce(bsolved, false) = false`,
  },
  {
    label: 'cancelled but ncr in (0,2)',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket = 'cancelled' AND coalesce(ncancelreason, 0) IN (0, 2)`,
  },
  {
    label: 'open/assigned but ncr not 0/2',
    sql: `SELECT count(*)::int n FROM calls_latest_hot
      WHERE logged_at >= '2026-01-01' AND status_bucket IN ('open_unallocated','assigned') AND coalesce(ncancelreason, 0) NOT IN (0, 2)`,
  },
];

async function main() {
  await withAppClient(async (client) => {
    console.log('=== Internal status consistency (YTD 2026) ===');
    let any = false;
    for (const { label, sql } of CHECKS) {
      const r = await client.query<{ n: number }>(sql);
      const n = r.rows[0]?.n ?? 0;
      if (n > 0) {
        any = true;
        console.log(`${String(n).padStart(6)}  ${label}`);
      }
    }
    if (!any) console.log('No internal inconsistencies found.');
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
