import { withAppClient } from '@/lib/read-model/db';

const MERGE_MS = 300_000;

/**
 * Collapse every MB51 import into one canonical dataset so FIFO / KPIs are overall.
 * Oldest import wins as the id; duplicate movement lines are dropped; other imports go away.
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

        // In-import dedupe after the move (unique index may already have blocked some).
        await client.query(
          `
          DELETE FROM mb51_aging_rows a
          USING mb51_aging_rows b
          WHERE a.import_id = $1
            AND b.import_id = $1
            AND a.id > b.id
            AND a.material_document = b.material_document
            AND a.plant = b.plant
            AND a.material = b.material
            AND a.movement_type = b.movement_type
            AND a.posting_date_serial = b.posting_date_serial
            AND a.qty = b.qty
            AND a.vendor = b.vendor
            AND a.uom = b.uom
            AND a.item_text = b.item_text
          `,
          [canonical]
        );

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
