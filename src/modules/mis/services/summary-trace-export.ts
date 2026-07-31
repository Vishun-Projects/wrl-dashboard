import type { BranchSummaryRow } from '@/lib/summary/derive';
import { formatDisplayRegion } from '@/modules/mis/client-import';
import {
  BD_MIS_ZONES,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisZone,
} from '@/modules/mis/services/bd-mis-summary';
import {
  buildClientOnlyRegionalRows,
  displayLoggedCallCount,
  findBranchRowMetric,
  mergeSelectedMetrics,
  resolveSummaryRegionMetric,
  resolveSummaryRegionOpenCalls,
  sumMergedAccountMetric,
  sumMergedAccountOpenCalls,
  type ClientMergeWithCrmPrefs,
  type MergeSelection,
} from '@/modules/mis/components/SummaryMergedMetricCell';
import { mergeBranchSummaryRowsByName } from '@/modules/mis/services/report-page-helpers';

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

/** Flat branch row for Summary Excel (metrics already merged for display). */
export type UiBranchPerformanceRow = UiRegionalPerformanceRow & {
  branch: string;
};

export type SummaryDashboardExportAlign = {
  regionalRows: UiRegionalPerformanceRow[];
  aiRow: UiRegionalPerformanceRow;
  branchRows: UiBranchPerformanceRow[];
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

const EMPTY_UI_ROW = {
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
} as const satisfies UiRegionalPerformanceRow;

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

function mergeMetric(
  m: { mergeSelection: MergeSelection; crm: number; client: number }
): number {
  return mergeSelectedMetrics(m.crm, m.client, m.mergeSelection);
}

function branchTreeAggregate(
  item: BranchSummaryRow,
  key: keyof BranchSummaryRow,
  regionBranches: BranchSummaryRow[]
): number {
  const getAllChildren = (id: number): BranchSummaryRow[] => {
    const direct = regionBranches.filter((b) => b.parentId === id);
    let all = [...direct];
    for (const d of direct) {
      all = [...all, ...getAllChildren(d.officeId)];
    }
    return all;
  };
  return (
    Number(item[key] || 0) +
    getAllChildren(item.officeId).reduce((sum, d) => sum + Number(d[key] || 0), 0)
  );
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
    { ...EMPTY_UI_ROW }
  );
}

/**
 * Regional + AI + branch rows matching Summary Dashboard display math
 * (account-aligned Cadbury/Coke merge when CRM + client sources are on).
 */
export function buildSummaryDashboardExportAlign(input: {
  summaryData: BranchSummaryRow[];
  clientSummaryData?: BranchSummaryRow[] | Array<Record<string, unknown>>;
  clientAccountSummaryData?: Array<Record<string, unknown>>;
  mergedAccountRows: Array<Record<string, unknown>>;
  mergeFlags: MergeSelection;
  clientMergeWithCrm: ClientMergeWithCrmPrefs;
  clientOnlyMode: boolean;
}): SummaryDashboardExportAlign {
  const {
    summaryData,
    clientSummaryData,
    clientAccountSummaryData,
    mergedAccountRows,
    mergeFlags,
    clientMergeWithCrm,
    clientOnlyMode,
  } = input;
  const alignCrmToAccounts = mergeFlags.crm && mergeFlags.client;
  const clientBranches = clientSummaryData as BranchSummaryRow[] | undefined;

  let regionalRows: UiRegionalPerformanceRow[];
  let aiRow: UiRegionalPerformanceRow;

  if (clientOnlyMode) {
    regionalRows = buildClientOnlyRegionalRows(clientAccountSummaryData).map((r) => ({
      region: r.region,
      total_calls: r.total_calls,
      solved_calls: r.total_solved,
      cancelled_calls: r.cancelled_calls,
      open_calls: r.open_calls,
      age_2: r.age_2,
      age_3: r.age_3,
      age_7: r.age_7,
      age_15: r.age_15,
      part_pending: r.part_pending,
      active_eng: r.active_eng,
    }));
    aiRow = sumUiRegionalRows(regionalRows);
  } else if (alignCrmToAccounts) {
    const regions = Array.from(
      new Set(mergedAccountRows.map((b) => formatDisplayRegion(String(b.region ?? ''))))
    ).sort();
    regionalRows = regions.map((region) => {
      const crmFallback = (field: keyof BranchSummaryRow) =>
        summaryData
          .filter((b) => formatDisplayRegion(b.region) === region)
          .reduce((sum, b) => sum + Number(b[field] || 0), 0);
      const clientField = (field: string) =>
        mergeFlags.client
          ? clientAccountSummaryData
            ? clientAccountSummaryData
                .filter((a) => formatDisplayRegion(String(a.region ?? '')) === region)
                .reduce(
                  (sum, a) =>
                    sum +
                    Number(
                      a[field === 'solved_calls' ? 'total_solved' : field] ?? 0
                    ),
                  0
                )
            : 0
          : 0;

      const mTotal = resolveSummaryRegionMetric(
        true,
        mergedAccountRows,
        clientAccountSummaryData,
        region,
        'total_calls',
        mergeFlags,
        clientMergeWithCrm,
        crmFallback('total_calls'),
        clientField('total_calls')
      );
      const mSolved = resolveSummaryRegionMetric(
        true,
        mergedAccountRows,
        clientAccountSummaryData,
        region,
        'total_solved',
        mergeFlags,
        clientMergeWithCrm,
        crmFallback('solved_calls'),
        clientField('total_solved')
      );
      const mCancelled = resolveSummaryRegionMetric(
        true,
        mergedAccountRows,
        clientAccountSummaryData,
        region,
        'cancelled_calls',
        mergeFlags,
        clientMergeWithCrm,
        crmFallback('cancelled_calls'),
        clientField('cancelled_calls')
      );
      const mOpen = resolveSummaryRegionOpenCalls(
        true,
        mergedAccountRows,
        clientAccountSummaryData,
        region,
        mergeFlags,
        clientMergeWithCrm,
        crmFallback('open_calls'),
        clientField('age_2') +
          clientField('age_3') +
          clientField('age_7') +
          clientField('age_15')
      );
      const metric = (field: string, crmKey: keyof BranchSummaryRow) =>
        mergeMetric(
          resolveSummaryRegionMetric(
            true,
            mergedAccountRows,
            clientAccountSummaryData,
            region,
            field,
            mergeFlags,
            clientMergeWithCrm,
            crmFallback(crmKey),
            clientField(field)
          )
        );

      const totalCalls = mergeMetric(mTotal);
      const cancelledCalls = mergeMetric(mCancelled);
      return {
        region,
        // Same Total column as Summary Dashboard (adds cancelled when CRM is in the mix).
        total_calls: displayLoggedCallCount(totalCalls, cancelledCalls, clientOnlyMode),
        solved_calls: mergeMetric(mSolved),
        cancelled_calls: cancelledCalls,
        open_calls: mergeMetric(mOpen),
        age_2: metric('age_2', 'age_2'),
        age_3: metric('age_3', 'age_3'),
        age_7: metric('age_7', 'age_7'),
        age_15: metric('age_15', 'age_15'),
        part_pending: metric('part_pending', 'part_pending'),
        active_eng: metric('active_eng', 'active_eng'),
      };
    });
    // AI Total = account merge only (does NOT use displayLoggedCallCount) — matches yellow AI row.
    aiRow = {
      region: 'AI TOTAL',
      total_calls: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'total_calls',
        mergeFlags,
        clientMergeWithCrm
      ),
      solved_calls: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'total_solved',
        mergeFlags,
        clientMergeWithCrm
      ),
      cancelled_calls: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'cancelled_calls',
        mergeFlags,
        clientMergeWithCrm
      ),
      open_calls: sumMergedAccountOpenCalls(
        mergedAccountRows,
        clientAccountSummaryData,
        mergeFlags,
        clientMergeWithCrm
      ),
      age_2: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'age_2',
        mergeFlags,
        clientMergeWithCrm
      ),
      age_3: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'age_3',
        mergeFlags,
        clientMergeWithCrm
      ),
      age_7: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'age_7',
        mergeFlags,
        clientMergeWithCrm
      ),
      age_15: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'age_15',
        mergeFlags,
        clientMergeWithCrm
      ),
      part_pending: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'part_pending',
        mergeFlags,
        clientMergeWithCrm
      ),
      active_eng: sumMergedAccountMetric(
        mergedAccountRows,
        clientAccountSummaryData,
        'active_eng',
        mergeFlags,
        clientMergeWithCrm
      ),
    };
  } else {
    // CRM-only (or no sources): same region list / sums as legacy Summary Excel.
    const regions = Array.from(new Set(summaryData.map((b) => b.region))).sort();
    regionalRows = regions.map((region) => {
      const rb = summaryData.filter((b) => b.region === region);
      return {
        region,
        total_calls: rb.reduce((s, b) => s + Number(b.total_calls || 0), 0),
        solved_calls: rb.reduce((s, b) => s + Number(b.solved_calls || 0), 0),
        cancelled_calls: rb.reduce((s, b) => s + Number(b.cancelled_calls || 0), 0),
        open_calls: rb.reduce((s, b) => s + Number(b.open_calls || 0), 0),
        age_2: rb.reduce((s, b) => s + Number(b.age_2 || 0), 0),
        age_3: rb.reduce((s, b) => s + Number(b.age_3 || 0), 0),
        age_7: rb.reduce((s, b) => s + Number(b.age_7 || 0), 0),
        age_15: rb.reduce((s, b) => s + Number(b.age_15 || 0), 0),
        part_pending: rb.reduce((s, b) => s + Number(b.part_pending || 0), 0),
        active_eng: rb.reduce((s, b) => s + Number(b.active_eng || 0), 0),
      };
    });
    aiRow = { ...sumUiRegionalRows(regionalRows), region: 'AI TOTAL' };
  }

  const branchRows: UiBranchPerformanceRow[] = [];
  if (clientOnlyMode) {
    const byRegion = new Map<string, BranchSummaryRow[]>();
    for (const raw of clientBranches ?? []) {
      const region = formatDisplayRegion(String(raw.region ?? ''));
      const list = byRegion.get(region) ?? [];
      list.push(raw as BranchSummaryRow);
      byRegion.set(region, list);
    }
    for (const [region, rows] of [...byRegion.entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      for (const b of mergeBranchSummaryRowsByName(rows)) {
        branchRows.push({
          branch: b.branch,
          region,
          total_calls: Number(b.total_calls || 0),
          solved_calls: Number(b.solved_calls || 0),
          cancelled_calls: Number(b.cancelled_calls || 0),
          open_calls: Number(b.open_calls || 0),
          age_2: Number(b.age_2 || 0),
          age_3: Number(b.age_3 || 0),
          age_7: Number(b.age_7 || 0),
          age_15: Number(b.age_15 || 0),
          part_pending: Number(b.part_pending || 0),
          active_eng: Number(b.active_eng || 0),
        });
      }
    }
  } else {
    for (const region of Array.from(new Set(summaryData.map((b) => b.region))).sort()) {
      const regionBranches = summaryData.filter((b) => b.region === region);
      const rawTopLevel = regionBranches.filter(
        (b) => b.parentId === 0 || !regionBranches.some((p) => p.officeId === b.parentId)
      );
      for (const b of mergeBranchSummaryRowsByName(rawTopLevel)) {
        const metric = (key: keyof BranchSummaryRow) =>
          mergeSelectedMetrics(
            branchTreeAggregate(b, key, regionBranches),
            findBranchRowMetric(
              clientBranches as Array<Record<string, unknown>> | undefined,
              region,
              b.branch,
              String(key)
            ),
            mergeFlags
          );
        branchRows.push({
          branch: b.branch,
          region,
          total_calls: metric('total_calls'),
          solved_calls: metric('solved_calls'),
          cancelled_calls: metric('cancelled_calls'),
          open_calls: metric('open_calls'),
          age_2: metric('age_2'),
          age_3: metric('age_3'),
          age_7: metric('age_7'),
          age_15: metric('age_15'),
          part_pending: metric('part_pending'),
          active_eng: metric('active_eng'),
        });
      }
    }
    branchRows.sort((a, b) => b.total_calls - a.total_calls);
  }

  return { regionalRows, aiRow, branchRows };
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
