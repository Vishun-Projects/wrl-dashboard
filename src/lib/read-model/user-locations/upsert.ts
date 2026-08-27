import type pg from 'pg';
import type { UserLocationRow } from './map';

export const USER_LOCATION_COLUMNS = [
  'ncode',
  'user_id',
  'office_id',
  'latlong',
  'added_on',
  'added_on_raw',
  'acode',
  'action_type',
  'distance',
  'trn_ncode',
  'trn_no',
  'customer_name',
  'travel_mode',
] as const;

const UPDATE_SET = USER_LOCATION_COLUMNS.filter((c) => c !== 'ncode')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('synced_at = now()')
  .join(', ');

function rowValues(row: UserLocationRow): unknown[] {
  return USER_LOCATION_COLUMNS.map((c) => row[c]);
}

export async function upsertUserLocations(
  client: pg.PoolClient,
  rows: UserLocationRow[],
  batchSize = 100
): Promise<number> {
  if (rows.length === 0) return 0;
  const byKey = new Map<number, UserLocationRow>();
  for (const row of rows) byKey.set(row.ncode, row);
  const deduped = Array.from(byKey.values());

  let upserted = 0;
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * USER_LOCATION_COLUMNS.length;
      placeholders.push(
        `(${USER_LOCATION_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues(row));
    });
    await client.query(
      `
      INSERT INTO crm_user_locations (${USER_LOCATION_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (ncode) DO UPDATE SET ${UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }
  return upserted;
}
