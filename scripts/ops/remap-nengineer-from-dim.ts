/**
 * After chunk 59 (nengineer numeric) + dim_engineers refresh:
 * remap truncated hot nengineer values to the matching dim_engineers.ncode by name.
 *
 * Usage: npx tsx scripts/ops/remap-nengineer-from-dim.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withClient } from '@/lib/read-model/db';
import { refreshDimensions } from '@/lib/read-model/dims';
import { tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';

async function main() {
  await withClient(async (client) => {
    if (!(await tryAcquireSyncLock(client))) {
      throw new Error('sync lock not acquired');
    }
    try {
      const dims = await refreshDimensions(client);
      console.log('dims refreshed', dims);

      const before = await client.query<{
        collided_ids: number;
        sample_trn: string | null;
        sample_eng: string | null;
        sample_name: string | null;
      }>(`
        SELECT
          (SELECT count(*)::int FROM (
             SELECT nengineer FROM calls_latest_hot
             WHERE nengineer IS NOT NULL
             GROUP BY nengineer
             HAVING count(DISTINCT engineer_name) > 1
           ) t) AS collided_ids,
          (SELECT vtrnno FROM calls_latest_hot WHERE vtrnno = '26H101059' LIMIT 1) AS sample_trn,
          (SELECT nengineer::text FROM calls_latest_hot WHERE vtrnno = '26H101059' LIMIT 1) AS sample_eng,
          (SELECT engineer_name FROM calls_latest_hot WHERE vtrnno = '26H101059' LIMIT 1) AS sample_name
      `);
      console.log('before', before.rows[0]);

      // Unique name → single dim code only (skip ambiguous names).
      const result = await client.query(`
        WITH unique_names AS (
          SELECT
            upper(btrim(regexp_replace(vname, '\\s+', ' ', 'g'))) AS name_key,
            (array_agg(ncode ORDER BY ncode))[1] AS ncode
          FROM dim_engineers
          WHERE nullif(btrim(vname), '') IS NOT NULL
          GROUP BY 1
          HAVING count(*) = 1
        )
        UPDATE calls_latest_hot h
        SET nengineer = u.ncode
        FROM unique_names u
        WHERE h.engineer_name IS NOT NULL
          AND upper(btrim(regexp_replace(h.engineer_name, '\\s+', ' ', 'g'))) = u.name_key
          AND h.nengineer IS DISTINCT FROM u.ncode
          AND trunc(h.nengineer) = trunc(u.ncode)
      `);
      console.log('hot rows remapped', result.rowCount);

      const mirror = await client.query(`
        WITH unique_names AS (
          SELECT
            upper(btrim(regexp_replace(vname, '\\s+', ' ', 'g'))) AS name_key,
            (array_agg(ncode ORDER BY ncode))[1] AS ncode
          FROM dim_engineers
          WHERE nullif(btrim(vname), '') IS NOT NULL
          GROUP BY 1
          HAVING count(*) = 1
        )
        UPDATE calls_crm_mirror m
        SET nengineer = u.ncode
        FROM unique_names u
        WHERE m.engineer_name IS NOT NULL
          AND upper(btrim(regexp_replace(m.engineer_name, '\\s+', ' ', 'g'))) = u.name_key
          AND m.nengineer IS DISTINCT FROM u.ncode
          AND trunc(m.nengineer) = trunc(u.ncode)
      `);
      console.log('mirror rows remapped', mirror.rowCount);

      const check = await client.query(`
        SELECT
          (SELECT count(*)::int FROM (
             SELECT nengineer FROM calls_latest_hot
             WHERE nengineer IS NOT NULL
             GROUP BY nengineer
             HAVING count(DISTINCT engineer_name) > 1
           ) t) AS collided_ids,
          (SELECT ncode::text FROM dim_engineers WHERE upper(btrim(vname)) = 'MITHLESH KUMAR SAH' LIMIT 1) AS mithlesh_code,
          (SELECT ncode::text FROM dim_engineers WHERE upper(btrim(vname)) = 'CHHOTU KUMAR' LIMIT 1) AS chhotu_code,
          (SELECT nengineer::text FROM calls_latest_hot WHERE vtrnno = '26H101059') AS call_eng,
          (SELECT engineer_name FROM calls_latest_hot WHERE vtrnno = '26H101059') AS call_name
      `);
      console.log('verify', check.rows[0]);

      await releaseSyncLock(client, 'ok', result.rowCount ?? 0);
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
