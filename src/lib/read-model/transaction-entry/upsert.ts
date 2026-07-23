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
