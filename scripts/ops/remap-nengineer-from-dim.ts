/**
 * After chunks 59/60 (numeric CRM user codes) + dim_engineers refresh:
 * remap truncated nengineer / attendance user_id values to dim_engineers.ncode by name.
 *
 * Match key = normalized name + trunc(code), so "Sanjay Banik" at 492 maps to 492.46
 * even when another office also has "SANJAY BANIK" as 1107.11.
 *
 * Usage: npx tsx scripts/ops/remap-nengineer-from-dim.ts
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withClient } from '@/lib/read-model/db';
import { refreshDimensions } from '@/lib/read-model/dims';

const NAME = (col: string) =>
  `upper(btrim(regexp_replace(regexp_replace(${col}, E'[\\t\\n\\r]+', ' ', 'g'), '\\s+', ' ', 'g')))`;

const CANDIDATES_CTE = `
  candidates AS (
    SELECT
      ${NAME('vname')} AS name_key,
      trunc(ncode) AS trunc_id,
      (array_agg(ncode ORDER BY ncode))[1] AS ncode
    FROM dim_engineers
    WHERE nullif(btrim(vname), '') IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) = 1
  )
`;

async function main() {
  await withClient(async (client) => {
    const dims = await refreshDimensions(client);
    console.log('dims refreshed', dims);

    const hot = await client.query(`
      WITH ${CANDIDATES_CTE}
      UPDATE calls_latest_hot h
      SET nengineer = c.ncode
      FROM candidates c
      WHERE h.engineer_name IS NOT NULL
        AND ${NAME('h.engineer_name')} = c.name_key
        AND trunc(h.nengineer) = c.trunc_id
        AND h.nengineer IS DISTINCT FROM c.ncode
    `);
    console.log('hot nengineer remapped', hot.rowCount);

    const mirror = await client.query(`
      WITH ${CANDIDATES_CTE}
      UPDATE calls_crm_mirror m
      SET nengineer = c.ncode
      FROM candidates c
      WHERE m.engineer_name IS NOT NULL
        AND ${NAME('m.engineer_name')} = c.name_key
        AND trunc(m.nengineer) = c.trunc_id
        AND m.nengineer IS DISTINCT FROM c.ncode
    `);
    console.log('mirror nengineer remapped', mirror.rowCount);

    const attendance = await client.query(`
      WITH ${CANDIDATES_CTE}
      UPDATE crm_attendance_details a
      SET user_id = c.ncode
      FROM candidates c
      WHERE a.attd_user IS NOT NULL
        AND ${NAME('a.attd_user')} = c.name_key
        AND trunc(a.user_id) = c.trunc_id
        AND a.user_id IS DISTINCT FROM c.ncode
    `);
    console.log('attendance user_id remapped', attendance.rowCount);

    const check = await client.query(`
      SELECT
        (SELECT count(*)::int FROM (
           SELECT nengineer FROM calls_latest_hot
           WHERE nengineer IS NOT NULL
           GROUP BY nengineer
           HAVING count(DISTINCT engineer_name) > 1
         ) t) AS hot_collided_ids,
        (SELECT count(*)::int FROM (
           SELECT user_id FROM crm_attendance_details
           WHERE user_id IS NOT NULL
           GROUP BY user_id
           HAVING count(DISTINCT attd_user) > 1
         ) t) AS attendance_collided_ids,
        (SELECT nengineer::text FROM calls_latest_hot WHERE vtrnno = '26H101059') AS call_eng
    `);
    console.log('verify', check.rows[0]);
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
