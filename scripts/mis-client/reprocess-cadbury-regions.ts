/**
 * Re-normalize client import rows (region, status, dates) from stored raw JSON.
 *
 * Usage: npx tsx scripts/mis-client/reprocess-cadbury-regions.ts [sourceCode...]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local') });
config({ path: join(__dirname, '..', '..', '.env') });

import { loadSourceConfigByCode } from '@/lib/mis-client-import/config';
import { normalizeClientRows } from '@/lib/mis-client-import/normalize';
import { withAppClient } from '@/lib/read-model/db';

const BATCH_SIZE = 500;

async function flushBatch(
  client: import('pg').PoolClient,
  batch: Array<{
    id: string;
    region: string;
    state: string | null;
    branch_label: string | null;
    status_bucket: string;
    status_label: string;
    is_part_pending: boolean;
    logged_at: Date | null;
    solved_at: Date | null;
  }>
): Promise<void> {
  if (!batch.length) return;
  const ids: string[] = [];
  const regions: string[] = [];
  const states: (string | null)[] = [];
  const branches: (string | null)[] = [];
  const statusBuckets: string[] = [];
  const statusLabels: string[] = [];
  const partPending: boolean[] = [];
  const loggedAt: (Date | null)[] = [];
  const solvedAt: (Date | null)[] = [];
  for (const row of batch) {
    ids.push(row.id);
    regions.push(row.region);
    states.push(row.state);
    branches.push(row.branch_label);
    statusBuckets.push(row.status_bucket);
    statusLabels.push(row.status_label);
    partPending.push(row.is_part_pending);
    loggedAt.push(row.logged_at);
    solvedAt.push(row.solved_at);
  }
  await client.query(
    `
    UPDATE mis_client_import_rows AS r
    SET
      region = v.region,
      state = v.state,
      branch_label = v.branch_label,
      status_bucket = v.status_bucket::status_bucket_type,
      status_label = v.status_label,
      is_part_pending = v.is_part_pending,
      logged_at = v.logged_at,
      solved_at = v.solved_at
    FROM unnest(
      $1::bigint[], $2::text[], $3::text[], $4::text[],
      $5::text[], $6::text[], $7::boolean[], $8::timestamptz[], $9::timestamptz[]
    ) AS v(id, region, state, branch_label, status_bucket, status_label, is_part_pending, logged_at, solved_at)
    WHERE r.id = v.id
    `,
    [ids, regions, states, branches, statusBuckets, statusLabels, partPending, loggedAt, solvedAt]
  );
}

async function main() {
  const sourceCodes = process.argv.slice(2);
  const targets = sourceCodes.length > 0 ? sourceCodes : ['cadbury', 'coke'];

  for (const code of targets) {
    const config = await loadSourceConfigByCode(code);
    if (!config) {
      console.warn(`Skip ${code}: source config not found`);
      continue;
    }

    let updated = 0;
    let skipped = 0;

    await withAppClient(async (client) => {
      const res = await client.query<{ id: string; raw: Record<string, string> }>(
        `
        SELECT r.id, r.raw
        FROM mis_client_import_rows r
        JOIN mis_client_sources s ON s.id = r.source_id
        WHERE s.code = $1
          AND r.raw IS NOT NULL
        ORDER BY r.id
        `,
        [code]
      );

      let batch: Array<{
        id: string;
        region: string;
        state: string | null;
        branch_label: string | null;
        status_bucket: string;
        status_label: string;
        is_part_pending: boolean;
        logged_at: Date | null;
        solved_at: Date | null;
      }> = [];

      for (const row of res.rows) {
        const raw = row.raw;
        if (!raw || typeof raw !== 'object') {
          skipped += 1;
          continue;
        }
        const { rows: normalized, errors } = normalizeClientRows(config, [raw]);
        if (errors.length || !normalized[0]) {
          skipped += 1;
          continue;
        }
        const n = normalized[0];
        batch.push({
          id: row.id,
          region: n.region,
          state: n.state,
          branch_label: n.branch_label,
          status_bucket: n.status_bucket,
          status_label: n.status_label,
          is_part_pending: n.is_part_pending,
          logged_at: n.logged_at,
          solved_at: n.solved_at,
        });
        updated += 1;

        if (batch.length >= BATCH_SIZE) {
          await flushBatch(client, batch);
          batch = [];
          process.stdout.write(`\r${code}: ${updated} updated...`);
        }
      }

      await flushBatch(client, batch);
    });

    console.log(`\n${code}: ${updated} updated, ${skipped} skipped.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
