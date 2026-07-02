import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
import '@/lib/read-model/bootstrap-env';
import { withClient, closePool } from '@/lib/read-model/db';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';

const APPLY = process.argv.includes('--apply');

async function main() {
  const count = await withClient(async (client) => {
    const r = await client.query<{ n: number }>(`
      SELECT count(*)::int n FROM calls_latest_hot
      WHERE status_bucket IN ('assigned','open_unallocated')
        AND coalesce(ncancelreason, 0) NOT IN (0, 2)
    `);
    return r.rows[0].n;
  });
  console.log(`Rows with ncancelreason set but open/assigned status: ${count}`);
  if (!APPLY || count === 0) {
    if (!APPLY && count > 0) console.log('Run with --apply to fix');
    return;
  }
  const fixed = await withClient((client) => repairHotCancelFromNcrReason(client));
  console.log(`Fixed ${fixed} row(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
