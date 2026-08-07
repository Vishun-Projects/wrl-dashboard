import { config } from 'dotenv';
import { join } from 'path';

// Load local environment files
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Bootstrap MIS email environments
import '@/modules/mis-email/services/bootstrap-env';

import { withAppClient } from '@/lib/read-model/db';

async function main() {
  await withAppClient(async (client) => {
    // 1. Get distinct accounts
    const accountsRes = await client.query(`
      SELECT account, COUNT(*) as cnt
      FROM calls_latest_hot
      GROUP BY account
      ORDER BY cnt DESC
    `);
    console.log('--- All Accounts in calls_latest_hot ---');
    accountsRes.rows.forEach(r => console.log(`- "${r.account}": ${r.cnt} calls`));
    console.log('');

    // 2. Query counts specifically for Cadbury / Mondelez and Coke
    // Let's search case-insensitively or with common names
    console.log('--- Counts for Coke & Cadbury ---');
    const countsRes = await client.query(`
      SELECT 
        account,
        status_bucket::text as status,
        engineer_name,
        COUNT(*) as cnt
      FROM calls_latest_hot
      WHERE account ILIKE '%coke%' OR account ILIKE '%cadbury%' OR account ILIKE '%mondelez%'
      GROUP BY account, status_bucket, engineer_name
      ORDER BY account, status, cnt DESC
    `);

    // Let's process the rows in JS to categorize as:
    // - Open vs Solved vs Cancelled (based on status_bucket)
    // - Unassigned (empty, '-', '—', or 'unassigned') vs Assigned
    const categories: Record<string, {
      open_assigned: number;
      open_unassigned: number;
      solved: number;
      cancelled: number;
      other: number;
    }> = {};

    for (const r of countsRes.rows) {
      const acc = r.account || 'Unknown';
      if (!categories[acc]) {
        categories[acc] = { open_assigned: 0, open_unassigned: 0, solved: 0, cancelled: 0, other: 0 };
      }

      const status = String(r.status || '').toLowerCase();
      const eng = String(r.engineer_name || '').trim().toLowerCase();
      const count = Number(r.cnt);

      const isUnassigned = !eng || eng === '-' || eng === '—' || eng === 'unassigned';

      // Map status bucket to counts_toward
      // bucket can be: 'cancelled', 'solved', 'tech_solved', 'open_unallocated', 'assigned'
      if (status === 'cancelled') {
        categories[acc].cancelled += count;
      } else if (status === 'solved' || status === 'tech_solved') {
        categories[acc].solved += count;
      } else if (status === 'open_unallocated' || status === 'assigned' || status.includes('open')) {
        if (isUnassigned) {
          categories[acc].open_unassigned += count;
        } else {
          categories[acc].open_assigned += count;
        }
      } else {
        categories[acc].other += count;
      }
    }

    console.log(JSON.stringify(categories, null, 2));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
