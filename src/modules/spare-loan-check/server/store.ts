import { withAppClient } from '@/lib/read-model/db';
import type {
  SpareLoanCheckSummary,
  SpareLoanProblemRow,
} from '@/modules/spare-loan-check/types';

export type SpareLoanPlantSnapshot = {
  plant: string;
  summary: SpareLoanCheckSummary;
  rows: SpareLoanProblemRow[];
};

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
              `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
            );
            values.push(
              plant,
              r.vendorNo,
              r.vendorName || null,
              r.material || null,
              r.materialDescription || null,
              r.barcode || null,
              r.soLoan || null,
              r.soConRtn || null,
              r.matchKey,
              r.matchSource,
              r.crmVtrnno,
              r.crmVendorCode,
              r.reason,
              r.cancelReason
            );
          }
          await client.query(
            `
            INSERT INTO spare_loan_check_rows (
              plant, vendor_no, vendor_name, material, material_description, barcode,
              so_loan, so_con_rtn, match_key, match_source,
              crm_vtrnno, crm_vendor_code, reason, cancel_reason
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
