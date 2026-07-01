import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });

import { withAppClient } from '@/lib/read-model/db';

async function main() {
  await withAppClient(async (c) => {
    const r = await c.query(`
      SELECT
        count(*) FILTER (WHERE COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%')::int AS plant_west,
        count(*) FILTER (WHERE upper(trim(h.region)) LIKE '%WEST%')::int AS crm_region_west,
        count(*) FILTER (
          WHERE COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
            AND upper(trim(h.region)) NOT LIKE '%WEST%'
        )::int AS remapped_into_west,
        count(*) FILTER (
          WHERE upper(trim(h.region)) LIKE '%WEST%'
            AND COALESCE(p.region_zone, upper(trim(h.region))) NOT LIKE '%WEST%'
        )::int AS remapped_out_of_west
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
    `);
    console.log('West plant remap stats:', r.rows[0]);

    const offices = await c.query(`
      SELECT h.nofficeid, COALESCE(d.vcompanyname, h.branch_name) AS branch,
             upper(trim(h.region)) AS crm_region,
             p.region_zone AS plant_zone,
             count(*)::int AS n
      FROM calls_latest_hot h
      LEFT JOIN mis_plant_region_mappings p ON p.office_id = h.nofficeid
      LEFT JOIN office_details d ON d.nofficeid = h.nofficeid
      WHERE h.logged_at >= '2026-01-01' AND h.logged_at <= '2026-06-29 23:59:59'
        AND upper(trim(h.call_type)) = 'BREAKDOWN'
        AND h.status_bucket != 'cancelled'
        AND COALESCE(p.region_zone, upper(trim(h.region))) LIKE '%WEST%'
      GROUP BY 1,2,3,4
      HAVING upper(trim(h.region)) NOT LIKE '%WEST%'
      ORDER BY n DESC
      LIMIT 15
    `);
    console.log('\nOffices counted WEST via plant but CRM region not WEST:');
    for (const row of offices.rows) console.log(row);
  });
}

main().catch(console.error);
