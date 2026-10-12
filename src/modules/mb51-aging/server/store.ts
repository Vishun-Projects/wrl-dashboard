import { withAppClient } from '@/lib/read-model/db';
import type {
  Mb51AgingImportMeta,
  Mb51AgingMovement,
} from '@/modules/mb51-aging/types';

const BATCH_SIZE = 800;
const DAY = 86400000;
const EPOCH_OFFSET = 25569;

function serialToIsoDate(serial: number): string {
  try {
    const d = new Date(Math.round((serial - EPOCH_OFFSET) * DAY));
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function fetchLatestMb51AgingData(): Promise<{
  latestImport: Mb51AgingImportMeta | null;
  rows: Mb51AgingMovement[];
}> {
  return withAppClient(async (client) => {
    const importRes = await client.query<{
      id: string;
      file_name: string;
      uploaded_by: string | null;
      row_count: number;
      plant_count: number;
      material_count: number;
      imported_at: Date;
    }>(
      `
      SELECT id, file_name, uploaded_by, row_count, plant_count, material_count, imported_at
      FROM mb51_aging_imports
      ORDER BY imported_at DESC
      LIMIT 1
      `
    );

    if (importRes.rows.length === 0) {
      return { latestImport: null, rows: [] };
    }

    const imp = importRes.rows[0];
    const latestImport: Mb51AgingImportMeta = {
      id: imp.id,
      fileName: imp.file_name,
      uploadedBy: imp.uploaded_by,
      rowCount: imp.row_count,
      plantCount: imp.plant_count,
      materialCount: imp.material_count,
      importedAt: imp.imported_at.toISOString(),
    };

    const rowsRes = await client.query<{
      posting_date_serial: number;
      qty: string;
      material: string;
      material_description: string;
      material_group: string;
      uom: string;
      vendor: string;
      vendor_name: string;
      plant: string;
      material_document: string;
      movement_type: string;
      movement_type_text: string;
      seq_order: number;
    }>(
      `
      SELECT
        posting_date_serial,
        qty,
        material,
        material_description,
        material_group,
        uom,
        vendor,
        vendor_name,
        plant,
        material_document,
        movement_type,
        movement_type_text,
        seq_order
      FROM mb51_aging_rows
      WHERE import_id = $1
      ORDER BY seq_order ASC
      `,
      [imp.id]
    );

    const rows: Mb51AgingMovement[] = rowsRes.rows.map((r) => ({
      d: r.posting_date_serial,
      q: Number(r.qty),
      m: r.material,
      md: r.material_description,
      g: r.material_group,
      u: r.uom,
      v: r.vendor,
      vn: r.vendor_name,
      mv: r.plant,
      dc: r.material_document,
      mt: r.movement_type,
      mtx: r.movement_type_text,
      s: r.seq_order,
    }));

    return { latestImport, rows };
  });
}

export async function saveMb51AgingImport(opts: {
  fileName: string;
  uploadedBy: string | null;
  rows: Mb51AgingMovement[];
  replaceExisting?: boolean;
}): Promise<Mb51AgingImportMeta> {
  const { fileName, uploadedBy, rows, replaceExisting = true } = opts;
  const plants = new Set(rows.map((r) => r.mv).filter(Boolean));
  const materials = new Set(rows.map((r) => r.m).filter(Boolean));

  return withAppClient(async (client) => {
    await client.query('BEGIN');
    try {
      if (replaceExisting) {
        // Keep the latest upload fresh; clear out older imports to keep storage efficient
        await client.query('DELETE FROM mb51_aging_imports');
      }

      const ins = await client.query<{ id: string; imported_at: Date }>(
        `
        INSERT INTO mb51_aging_imports (
          file_name, uploaded_by, row_count, plant_count, material_count
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, imported_at
        `,
        [fileName, uploadedBy, rows.length, plants.size, materials.size]
      );

      const importId = ins.rows[0]?.id;
      const importedAt = ins.rows[0]?.imported_at?.toISOString() ?? new Date().toISOString();
      if (!importId) throw new Error('Failed to create MB51 import');

      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const chunk = rows.slice(offset, offset + BATCH_SIZE);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let p = 1;

        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i];
          const seq = offset + i;
          const isoDate = serialToIsoDate(row.d);

          placeholders.push(
            `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
          );
          values.push(
            importId,
            row.d,
            isoDate,
            row.q,
            row.m ?? '',
            row.md ?? '',
            row.g ?? '',
            row.u ?? '',
            row.v ?? '',
            row.vn ?? '',
            row.mv ?? '',
            row.dc ?? '',
            row.mt ?? '',
            row.mtx ?? '',
            seq
          );
        }

        if (placeholders.length > 0) {
          await client.query(
            `
            INSERT INTO mb51_aging_rows (
              import_id,
              posting_date_serial,
              posting_date,
              qty,
              material,
              material_description,
              material_group,
              uom,
              vendor,
              vendor_name,
              plant,
              material_document,
              movement_type,
              movement_type_text,
              seq_order
            ) VALUES ${placeholders.join(',')}
            `,
            values
          );
        }
      }

      await client.query('COMMIT');

      return {
        id: importId,
        fileName,
        uploadedBy,
        rowCount: rows.length,
        plantCount: plants.size,
        materialCount: materials.size,
        importedAt,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
