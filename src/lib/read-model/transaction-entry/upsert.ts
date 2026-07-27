import type pg from 'pg';
import type { CrmTransactionEntryRow } from './crm-fetch';

const BATCH = Number(process.env.TRANSACTION_ENTRY_UPSERT_BATCH ?? 300) || 300;

export async function upsertTransactionEntryRows(
  client: pg.PoolClient,
  rows: CrmTransactionEntryRow[]
): Promise<number> {
  if (rows.length === 0) return 0;

  // Last write wins for duplicate (client, serial) within the batch set
  const byKey = new Map<string, CrmTransactionEntryRow>();
  for (const row of rows) {
    byKey.set(`${row.client}\0${row.productSerialNo}`, row);
  }
  const deduped = Array.from(byKey.values());

  let upserted = 0;
  for (let i = 0; i < deduped.length; i += BATCH) {
    const batch = deduped.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, idx) => {
      const o = idx * 7;
      placeholders.push(
        `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, now())`
      );
      values.push(
        row.client,
        row.productSerialNo,
        row.daddedonRaw || null,
        row.daddedon,
        row.uniqueId,
        row.warrantyStartRaw || null,
        row.warrantyStart
      );
    });

    await client.query(
      `INSERT INTO crm_transaction_entry
         (client, product_serial_no, daddedon_raw, daddedon, unique_id,
          warranty_start_raw, warranty_start, synced_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (client, product_serial_no) DO UPDATE SET
         daddedon_raw = EXCLUDED.daddedon_raw,
         daddedon = EXCLUDED.daddedon,
         unique_id = COALESCE(EXCLUDED.unique_id, crm_transaction_entry.unique_id),
         warranty_start_raw = EXCLUDED.warranty_start_raw,
         warranty_start = EXCLUDED.warranty_start,
         synced_at = now()`,
      values
    );
    upserted += batch.length;
  }
  return upserted;
}

/**
 * After a complete CRM fetch for one client + daddedon window (PROCESSED=Y only),
 * drop mirror rows in that window that were not returned (e.g. unprocessed ERROR rows).
 */
export async function replaceClientPeriodMirror(
  client: pg.PoolClient,
  account: string,
  dateFrom: string,
  dateTo: string,
  rows: CrmTransactionEntryRow[]
): Promise<{ upserted: number; deleted: number }> {
  const upserted = await upsertTransactionEntryRows(client, rows);
  const serials = [...new Set(rows.map((r) => r.productSerialNo).filter(Boolean))];

  let deleted = 0;
  if (serials.length === 0) {
    const res = await client.query(
      `DELETE FROM crm_transaction_entry
       WHERE client = $1
         AND daddedon >= $2::date
         AND daddedon < ($3::date + interval '1 day')`,
      [account, dateFrom, dateTo]
    );
    deleted = res.rowCount ?? 0;
  } else {
    const res = await client.query(
      `DELETE FROM crm_transaction_entry
       WHERE client = $1
         AND daddedon >= $2::date
         AND daddedon < ($3::date + interval '1 day')
         AND NOT (product_serial_no = ANY($4::text[]))`,
      [account, dateFrom, dateTo, serials]
    );
    deleted = res.rowCount ?? 0;
  }
  return { upserted, deleted };
}

/** Bulk-period replace: upsert fetched rows, then drop any other mirror rows in the daddedon window. */
export async function replacePeriodMirror(
  client: pg.PoolClient,
  dateFrom: string,
  dateTo: string,
  rows: CrmTransactionEntryRow[]
): Promise<{ upserted: number; deleted: number }> {
  const upserted = await upsertTransactionEntryRows(client, rows);

  await client.query(`
    CREATE TEMP TABLE IF NOT EXISTS _te_keep (
      client text NOT NULL,
      product_serial_no text NOT NULL,
      PRIMARY KEY (client, product_serial_no)
    ) ON COMMIT DROP
  `);
  await client.query(`TRUNCATE _te_keep`);

  const byKey = new Map<string, { client: string; serial: string }>();
  for (const row of rows) {
    byKey.set(`${row.client}\0${row.productSerialNo}`, {
      client: row.client,
      serial: row.productSerialNo,
    });
  }
  const keep = Array.from(byKey.values());
  for (let i = 0; i < keep.length; i += BATCH) {
    const batch = keep.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, idx) => {
      const o = idx * 2;
      placeholders.push(`($${o + 1}, $${o + 2})`);
      values.push(row.client, row.serial);
    });
    await client.query(
      `INSERT INTO _te_keep (client, product_serial_no) VALUES ${placeholders.join(', ')}
       ON CONFLICT DO NOTHING`,
      values
    );
  }

  const del = await client.query(
    `DELETE FROM crm_transaction_entry t
     WHERE t.daddedon >= $1::date
       AND t.daddedon < ($2::date + interval '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM _te_keep k
         WHERE k.client = t.client AND k.product_serial_no = t.product_serial_no
       )`,
    [dateFrom, dateTo]
  );
  return { upserted, deleted: del.rowCount ?? 0 };
}
