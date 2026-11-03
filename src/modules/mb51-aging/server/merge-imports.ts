import { withAppClient } from '@/lib/read-model/db';

const MERGE_MS = 300_000;

/**
 * Collapse every MB51 import into one canonical dataset so FIFO / KPIs are overall.
 * Oldest import wins as the id; lines already on the canonical fingerprint are
 * dropped from later imports; same-file duplicate lines are kept.
 */
export async function mergeMb51ToCanonical(): Promise<string | null> {
  return withAppClient(
    async (client) => {
      const listed = await client.query<{ id: string; file_name: string }>(
        `
        SELECT id, file_name
        FROM mb51_aging_imports
        ORDER BY imported_at ASC
        `
      );
      if (!listed.rows.length) return null;
      if (listed.rows.length === 1) return listed.rows[0].id;

      const canonical = listed.rows[0].id;
      const names = listed.rows.map((r) => r.file_name).filter(Boolean);

      await client.query('BEGIN');
      try {
        // Drop secondaries that already exist on the canonical fingerprint.
        await client.query(
          `
          DELETE FROM mb51_aging_rows sec
          USING mb51_aging_rows can
          WHERE can.import_id = $1
            AND sec.import_id <> $1
            AND sec.material_document = can.material_document
            AND sec.plant = can.plant
            AND sec.material = can.material
            AND sec.movement_type = can.movement_type
            AND sec.posting_date_serial = can.posting_date_serial
            AND sec.qty = can.qty
            AND sec.vendor = can.vendor
            AND sec.uom = can.uom
            AND sec.item_text = can.item_text
          `,
          [canonical]
        );

        await client.query(
          `UPDATE mb51_aging_rows SET import_id = $1 WHERE import_id <> $1`,
          [canonical]
        );

        // Keep in-file duplicate lines; only cross-import overlaps were removed above.
        await client.query(`DROP INDEX IF EXISTS idx_mb51_aging_rows_import_dedupe`);

        await client.query(`DELETE FROM mb51_aging_imports WHERE id <> $1`, [canonical]);

        const counts = await client.query<{
          n: number;
          plants: number;
          materials: number;
        }>(
          `
          SELECT
            count(*)::int AS n,
            count(DISTINCT NULLIF(plant, ''))::int AS plants,
            count(DISTINCT NULLIF(material, ''))::int AS materials
          FROM mb51_aging_rows
          WHERE import_id = $1
          `,
          [canonical]
        );
        const c = counts.rows[0];
        const label =
          names.length <= 1
            ? names[0] || 'MB51'
            : `${names[0]} (+${names.length - 1} file${names.length === 2 ? '' : 's'})`;

        await client.query(
          `
          UPDATE mb51_aging_imports
          SET file_name = $2,
              row_count = $3,
              plant_count = $4,
              material_count = $5
          WHERE id = $1
          `,
          [canonical, label, c?.n ?? 0, c?.plants ?? 0, c?.materials ?? 0]
        );

        await client.query('COMMIT');
        return canonical;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: MERGE_MS }
  );
}
