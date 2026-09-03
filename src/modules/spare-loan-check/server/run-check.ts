import {
  classifySpareLoanRow,
  selectMatchKey,
  toProblemRow,
} from '@/modules/spare-loan-check/server/match';
import {
  lookupItemCategoriesByMaterial,
  normalizeMaterialCode,
} from '@/modules/spare-loan-check/server/item-category';
import { lookupCallsByVtrnno } from '@/modules/spare-loan-check/server/lookup';
import { parseZss02Html } from '@/modules/spare-loan-check/server/parse-zss02-html';
import {
  saveSpareLoanCheckByPlant,
  type SpareLoanPlantSnapshot,
} from '@/modules/spare-loan-check/server/store';
import type {
  SpareLoanCheckResponse,
  SpareLoanCheckSummary,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
  Zss02ParsedRow,
} from '@/modules/spare-loan-check/types';

function emptyByReason(): Record<SpareLoanProblemReason, number> {
  return {
    vendor_mismatch: 0,
    cancelled: 0,
    unassigned_cancelled: 0,
  };
}

function emptySummary(): SpareLoanCheckSummary {
  return {
    parsed: 0,
    skipped: 0,
    ok: 0,
    problems: 0,
    byReason: emptyByReason(),
  };
}

export type RunSpareLoanCheckMeta = {
  fileName: string;
  uploadedBy: string | null;
};

export async function runSpareLoanCheck(
  html: string,
  meta: RunSpareLoanCheckMeta
): Promise<SpareLoanCheckResponse & { savedPlants: string[] }> {
  const parsedRows = parseZss02Html(html);
  const keyed: Array<{
    row: Zss02ParsedRow;
    match: NonNullable<ReturnType<typeof selectMatchKey>>;
  }> = [];

  const perPlant = new Map<
    string,
    { summary: SpareLoanCheckSummary; rows: SpareLoanProblemRow[] }
  >();

  function plantBucket(plant: string) {
    const key = plant.trim() || 'UNKNOWN';
    let b = perPlant.get(key);
    if (!b) {
      b = { summary: emptySummary(), rows: [] };
      perPlant.set(key, b);
    }
    return b;
  }

  for (const row of parsedRows) {
    const bucket = plantBucket(row.plant);
    bucket.summary.parsed += 1;
    const match = selectMatchKey(row.soLoan, row.soConRtn);
    if (!match) {
      bucket.summary.skipped += 1;
      continue;
    }
    keyed.push({ row, match });
  }

  const [callMap, categoryMap] = await Promise.all([
    lookupCallsByVtrnno(keyed.map((k) => k.match.key)),
    lookupItemCategoriesByMaterial(keyed.map((k) => k.row.material)),
  ]);
  const problems: SpareLoanProblemRow[] = [];
  const byReason = emptyByReason();
  let skipped = 0;
  let ok = 0;

  for (const { row, match } of keyed) {
    const bucket = plantBucket(row.plant);
    const call = callMap.get(match.key);
    const reason = classifySpareLoanRow(row.vendorNo, call);
    if (!reason) {
      ok += 1;
      bucket.summary.ok += 1;
      continue;
    }
    byReason[reason] += 1;
    bucket.summary.byReason[reason] += 1;
    bucket.summary.problems += 1;
    const itemCategory =
      categoryMap.get(normalizeMaterialCode(row.material)) ?? null;
    const problem = toProblemRow(row, match, reason, call, itemCategory);
    problems.push(problem);
    bucket.rows.push(problem);
  }

  for (const b of perPlant.values()) {
    skipped += b.summary.skipped;
  }

  const summary: SpareLoanCheckSummary = {
    parsed: parsedRows.length,
    skipped,
    ok,
    problems: problems.length,
    byReason,
  };

  const snapshots: SpareLoanPlantSnapshot[] = [...perPlant.entries()].map(
    ([plant, b]) => ({
      plant,
      summary: b.summary,
      rows: b.rows,
    })
  );

  const savedPlants = await saveSpareLoanCheckByPlant({
    fileName: meta.fileName,
    uploadedBy: meta.uploadedBy,
    snapshots,
  });

  return { summary, rows: problems, savedPlants };
}
