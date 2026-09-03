import { withAppClient } from '@/lib/read-model/db';
import type {
  SpareLoanCheckSummary,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
} from '@/modules/spare-loan-check/types';

export type SpareLoanPlantSnapshot = {
  plant: string;
  summary: SpareLoanCheckSummary;
  rows: SpareLoanProblemRow[];
};

export type SpareLoanSavedPlant = {
  plant: string;
  fileName: string;
  problems: number;
  importedAt: string;
};

function mapRow(row: Record<string, unknown>): SpareLoanProblemRow {
  return {
    plant: String(row.plant ?? ''),
    vendorNo: String(row.vendor_no ?? ''),
    vendorName: String(row.vendor_name ?? ''),
    material: String(row.material ?? ''),
    materialDescription: String(row.material_description ?? ''),
    itemCategory: row.item_category == null ? null : String(row.item_category),
    barcode: String(row.barcode ?? ''),
    soLoan: String(row.so_loan ?? ''),
    soConRtn: String(row.so_con_rtn ?? ''),
    matchKey: String(row.match_key ?? ''),
    matchSource: row.match_source === 'loan' ? 'loan' : 'con_rtn',
    crmVtrnno: row.crm_vtrnno == null ? null : String(row.crm_vtrnno),
    crmVendorCode: row.crm_vendor_code == null ? null : String(row.crm_vendor_code),
    crmVendorName: row.crm_vendor_name == null ? null : String(row.crm_vendor_name),
    reason: String(row.reason) as SpareLoanProblemReason,
    cancelReason: row.cancel_reason == null ? null : String(row.cancel_reason),
    callLoggedAt:
      row.call_logged_at == null
        ? null
        : row.call_logged_at instanceof Date
          ? row.call_logged_at.toISOString()
          : String(row.call_logged_at),
    lastEditedAt:
      row.last_edited_at == null
        ? null
        : row.last_edited_at instanceof Date
          ? row.last_edited_at.toISOString()
          : String(row.last_edited_at),
  };
}

const ROW_SELECT = `
  plant, vendor_no, vendor_name, material, material_description, item_category, barcode,
  so_loan, so_con_rtn, match_key, match_source,
  crm_vtrnno, crm_vendor_code, crm_vendor_name, reason, cancel_reason,
  call_logged_at, last_edited_at
`;

function emptySummary(): SpareLoanCheckSummary {
  return {
    parsed: 0,
    skipped: 0,
    ok: 0,
    problems: 0,
    byReason: { vendor_mismatch: 0, cancelled: 0, unassigned_cancelled: 0 },
  };
}

export async function listSpareLoanSavedPlants(): Promise<SpareLoanSavedPlant[]> {
  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      plant: string;
      file_name: string;
      problems: number;
      imported_at: Date;
    }>(
      `
      SELECT plant, file_name, problems, imported_at
      FROM spare_loan_check_imports
      ORDER BY plant
      `
    );
    return rows.map((r) => ({
      plant: r.plant,
      fileName: r.file_name,
      problems: Number(r.problems) || 0,
      importedAt: r.imported_at.toISOString(),
    }));
  });
}

export async function loadSpareLoanPlant(
  plant: string
): Promise<{ summary: SpareLoanCheckSummary; rows: SpareLoanProblemRow[] } | null> {
  const key = plant.trim();
  if (!key) return null;

  return withAppClient(async (client) => {
    const { rows: imports } = await client.query<{
      parsed: number;
      skipped: number;
      ok: number;
      problems: number;
      by_reason: Record<string, number> | null;
    }>(
      `
      SELECT parsed, skipped, ok, problems, by_reason
      FROM spare_loan_check_imports
      WHERE plant = $1
      `,
      [key]
    );
    const imp = imports[0];
    if (!imp) return null;

    const { rows } = await client.query(
      `
      SELECT ${ROW_SELECT}
      FROM spare_loan_check_rows
      WHERE plant = $1
      ORDER BY reason, match_key, vendor_no, material
      `,
      [key]
    );

    return {
      summary: {
        parsed: Number(imp.parsed) || 0,
        skipped: Number(imp.skipped) || 0,
        ok: Number(imp.ok) || 0,
        problems: Number(imp.problems) || 0,
        byReason: {
          vendor_mismatch: Number(imp.by_reason?.vendor_mismatch) || 0,
          cancelled: Number(imp.by_reason?.cancelled) || 0,
          unassigned_cancelled: Number(imp.by_reason?.unassigned_cancelled) || 0,
        },
      },
      rows: rows.map((r) => mapRow(r as Record<string, unknown>)),
    };
  });
}

/** Load all saved plants' problem rows (combined summary). */
export async function loadSpareLoanAllPlants(): Promise<{
  summary: SpareLoanCheckSummary;
  rows: SpareLoanProblemRow[];
  savedPlants: string[];
}> {
  return withAppClient(async (client) => {
    const { rows: imports } = await client.query<{
      plant: string;
      parsed: number;
      skipped: number;
      ok: number;
      problems: number;
      by_reason: Record<string, number> | null;
    }>(
      `
      SELECT plant, parsed, skipped, ok, problems, by_reason
      FROM spare_loan_check_imports
      ORDER BY plant
      `
    );

    const summary = emptySummary();
    const plants: string[] = [];
    for (const imp of imports) {
      plants.push(imp.plant);
      summary.parsed += Number(imp.parsed) || 0;
      summary.skipped += Number(imp.skipped) || 0;
      summary.ok += Number(imp.ok) || 0;
      summary.problems += Number(imp.problems) || 0;
      summary.byReason.vendor_mismatch += Number(imp.by_reason?.vendor_mismatch) || 0;
      summary.byReason.cancelled += Number(imp.by_reason?.cancelled) || 0;
      summary.byReason.unassigned_cancelled +=
        Number(imp.by_reason?.unassigned_cancelled) || 0;
    }

    const { rows } = await client.query(
      `
      SELECT ${ROW_SELECT}
      FROM spare_loan_check_rows
      ORDER BY plant, reason, match_key, vendor_no, material
      `
    );

    return {
      summary,
      rows: rows.map((r) => mapRow(r as Record<string, unknown>)),
      savedPlants: plants,
    };
  });
}

/** Replace prior snapshot for each plant (cascade deletes old problem rows). */
export async function saveSpareLoanCheckByPlant(params: {
  fileName: string;
  uploadedBy: string | null;
  snapshots: SpareLoanPlantSnapshot[];
}): Promise<string[]> {
  const { fileName, uploadedBy, snapshots } = params;
  if (snapshots.length === 0) return [];

  return withAppClient(async (client) => {
    await client.query('BEGIN');
    try {
      const saved: string[] = [];
      for (const snap of snapshots) {
        const plant = snap.plant.trim();
        if (!plant) continue;

        await client.query(`DELETE FROM spare_loan_check_imports WHERE plant = $1`, [plant]);

        await client.query(
          `
          INSERT INTO spare_loan_check_imports (
            plant, file_name, uploaded_by,
            parsed, skipped, ok, problems, by_reason, imported_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
          `,
          [
            plant,
            fileName,
            uploadedBy,
            snap.summary.parsed,
            snap.summary.skipped,
            snap.summary.ok,
            snap.summary.problems,
            JSON.stringify(snap.summary.byReason),
          ]
        );

        if (snap.rows.length > 0) {
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let i = 1;
          for (const r of snap.rows) {
            placeholders.push(
              `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
            );
            values.push(
              plant,
              r.vendorNo,
              r.vendorName || null,
              r.material || null,
              r.materialDescription || null,
              r.itemCategory || null,
              r.barcode || null,
              r.soLoan || null,
              r.soConRtn || null,
              r.matchKey,
              r.matchSource,
              r.crmVtrnno,
              r.crmVendorCode,
              r.crmVendorName,
              r.reason,
              r.cancelReason,
              r.callLoggedAt,
              r.lastEditedAt
            );
          }
          await client.query(
            `
            INSERT INTO spare_loan_check_rows (
              plant, vendor_no, vendor_name, material, material_description, item_category, barcode,
              so_loan, so_con_rtn, match_key, match_source,
              crm_vtrnno, crm_vendor_code, crm_vendor_name, reason, cancel_reason,
              call_logged_at, last_edited_at
            ) VALUES ${placeholders.join(',')}
            `,
            values
          );
        }

        saved.push(plant);
      }
      await client.query('COMMIT');
      return saved;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
