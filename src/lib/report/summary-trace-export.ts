import type { BranchSummaryRow } from '@/lib/report/summary-derive';
import { formatDisplayRegion } from '@/lib/mis-client-import/region';
import {
  BD_MIS_ZONES,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisZone,
} from '@/lib/report/bd-mis-summary';
import {
  mergeSelectedMetrics,
  type MergeSelection,
} from '@/components/report/SummaryMergedMetricCell';

export type UiRegionalPerformanceRow = {
  region: string;
  total_calls: number;
  solved_calls: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
};

const REGION_METRIC_KEYS = [
  'total_calls',
  'solved_calls',
  'cancelled_calls',
  'open_calls',
  'age_2',
  'age_3',
  'age_7',
  'age_15',
  'part_pending',
  'active_eng',
] as const satisfies ReadonlyArray<keyof UiRegionalPerformanceRow>;

function sumRegionBranchMetric(
  branches: BranchSummaryRow[] | undefined,
  zone: BdMisZone,
  key: keyof BranchSummaryRow
): number {
  if (!branches?.length) return 0;
  return branches
    .filter((b) => formatDisplayRegion(b.region) === zone)
    .reduce((sum, b) => sum + Number(b[key] ?? 0), 0);
}

/** Regional totals using the same CRM + client branch merge as the Summary dashboard UI. */
export function buildUiRegionalPerformanceRows(
  summaryData: BranchSummaryRow[],
  clientSummaryData: BranchSummaryRow[] | undefined,
  mergeFlags: MergeSelection
): UiRegionalPerformanceRow[] {
  return BD_MIS_ZONES.map((region) => {
    const row = { region } as UiRegionalPerformanceRow;
    for (const key of REGION_METRIC_KEYS) {
      row[key] = mergeSelectedMetrics(
        sumRegionBranchMetric(summaryData, region, key),
        sumRegionBranchMetric(clientSummaryData, region, key),
        mergeFlags
      );
    }
    return row;
  });
}

export function sumUiRegionalRows(rows: UiRegionalPerformanceRow[]): UiRegionalPerformanceRow {
  return rows.reduce<UiRegionalPerformanceRow>(
    (acc, row) => {
      const next = { ...acc };
      for (const key of REGION_METRIC_KEYS) {
        next[key] = acc[key] + row[key];
      }
      return next;
    },
    {
      region: 'All',
      total_calls: 0,
      solved_calls: 0,
      cancelled_calls: 0,
      open_calls: 0,
      age_2: 0,
      age_3: 0,
      age_7: 0,
      age_15: 0,
      part_pending: 0,
      active_eng: 0,
    }
  );
}

export function toBdMisRegionalRow(row: UiRegionalPerformanceRow): BdMisRegionalRow {
  return {
    region: row.region as BdMisZone,
    total_calls: row.total_calls,
    total_solved: row.solved_calls,
    cancelled_calls: row.cancelled_calls,
    open_calls: row.open_calls,
    age_2: row.age_2,
    age_3: row.age_3,
    age_7: row.age_7,
    age_15: row.age_15,
    part_pending: row.part_pending,
    active_eng: row.active_eng,
  };
}

export function toBdMisGrandRow(row: UiRegionalPerformanceRow): BdMisGrandRow {
  return {
    ...toBdMisRegionalRow(row),
    region: 'ALL',
  };
}
