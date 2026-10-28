/**
 * Apply MB51 snapshot schema bits and build the default FIFO snapshot
 * for the latest import.
 *
 * Usage: npx tsx scripts/maintenance/backfill-mb51-snapshot.ts
 */
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

import '@/lib/read-model/bootstrap-env';
import { closePool, withAppClient } from '@/lib/read-model/db';
import { buildDefaultSnapshot } from '@/modules/mb51-aging/server/fifo-from-db';

async function main() {
  const importId = await withAppClient(async (client) => {
    await client.query(`
      ALTER TABLE mb51_aging_rows
        ADD COLUMN IF NOT EXISTS item_text text NOT NULL DEFAULT '';

      CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_import_seq
        ON mb51_aging_rows (import_id, seq_order);

      CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_fifo_scan
        ON mb51_aging_rows (
          import_id, plant, vendor, material, uom, posting_date_serial, seq_order
        );

      CREATE TABLE IF NOT EXISTS mb51_aging_snapshots (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        import_id       uuid NOT NULL REFERENCES mb51_aging_imports(id) ON DELETE CASCADE,
        param_hash      text NOT NULL,
        params          jsonb NOT NULL DEFAULT '{}'::jsonb,
        summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
        row_count       integer NOT NULL DEFAULT 0,
        built_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (import_id, param_hash)
      );

      CREATE TABLE IF NOT EXISTS mb51_aging_agg_rows (
        id                    bigserial PRIMARY KEY,
        snapshot_id           uuid NOT NULL REFERENCES mb51_aging_snapshots(id) ON DELETE CASCADE,
        seq                   integer NOT NULL DEFAULT 0,
        group_key             text NOT NULL DEFAULT '',
        vendor                text NOT NULL DEFAULT '',
        vendor_name           text NOT NULL DEFAULT '',
        material_group        text NOT NULL DEFAULT '',
        material              text NOT NULL DEFAULT '',
        material_description  text NOT NULL DEFAULT '',
        uom                   text NOT NULL DEFAULT '',
        bk                    numeric(18, 3)[] NOT NULL DEFAULT ARRAY[]::numeric[],
        total                 numeric(18, 3) NOT NULL DEFAULT 0,
        full_qty              numeric(18, 3) NOT NULL DEFAULT 0,
        n                     integer NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_mb51_aging_agg_snapshot_seq
        ON mb51_aging_agg_rows (snapshot_id, seq);

      CREATE INDEX IF NOT EXISTS idx_mb51_aging_agg_snapshot_material
        ON mb51_aging_agg_rows (snapshot_id, material);
    `);

    const imp = await client.query<{ id: string; row_count: number; file_name: string }>(
      `SELECT id, row_count, file_name FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1`
    );
    if (!imp.rows[0]) return null;
    console.log(
      `building default snapshot for ${imp.rows[0].file_name} (${imp.rows[0].row_count} rows)…`
    );
    return imp.rows[0].id;
  });

  if (!importId) {
    console.log('no import to backfill');
    return;
  }

  await buildDefaultSnapshot(importId);

  await withAppClient(async (client) => {
    const snap = await client.query(
      `SELECT param_hash, row_count, summary->>'stockMat' AS stock_mat
       FROM mb51_aging_snapshots WHERE import_id = $1`,
      [importId]
    );
    console.log(JSON.stringify(snap.rows, null, 2));
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
