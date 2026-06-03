import {
  ARCP_DATE_FILTER_OPTIONS,
  arcpDetailDedupeKey,
  isArcpApproveDateColumn,
  type ArcpClaimsAggregateRow,
  type ArcpDateFilterColumn,
} from './query';
import { readArcpFromPostgresClient } from '@/lib/read-model/client-flags';

const LOG_PREFIX = '[ARCP]';

export function arcpBrowserDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_ARCP_DEBUG === 'true') return true;
  return process.env.NODE_ENV === 'development';
}

export type ArcpDebugFilters = {
  startDateStr: string;
  endDateStr: string;
  arcpDateFilterColumn: ArcpDateFilterColumn;
  branchParam?: string;
  franchiseeParam?: string;
  callTypeParam?: string;
};

function dateBasisLabel(column: ArcpDateFilterColumn): string {
  return (
    ARCP_DATE_FILTER_OPTIONS.find((o) => o.value === column)?.label ?? column
  );
}

function summarizeAggregates(rows: ArcpClaimsAggregateRow[]) {
  const months = new Set<string>();
  let qtyTotal = 0;
  let amountTotal = 0;
  let branchTotal = 0;
  let hoTotal = 0;
  for (const row of rows) {
    if (row.claim_month) months.add(String(row.claim_month));
    qtyTotal += Number(row.qty) || 0;
    amountTotal += Number(row.amount_payable) || 0;
    branchTotal += Number(row.branch_approved) || 0;
    hoTotal += Number(row.ho_approved) || 0;
  }
  return {
    aggregateRowCount: rows.length,
    claimMonths: [...months].sort(),
    claimMonthCount: months.size,
    qtyTotal,
    amountPayableTotal: Math.round(amountTotal * 100) / 100,
    branchApprovedTotal: Math.round(branchTotal * 100) / 100,
    hoApprovedTotal: Math.round(hoTotal * 100) / 100,
    sampleRows: rows.slice(0, 5),
  };
}

/** Log when you click Apply / load starts. */
export function logArcpFiltersApplied(
  filters: ArcpDebugFilters,
  reason: 'apply' | 'auto-load' | 'refresh'
): void {
  if (!arcpBrowserDebugEnabled()) return;

  const basis = dateBasisLabel(filters.arcpDateFilterColumn);
  console.groupCollapsed(
    `${LOG_PREFIX} Filters applied (${reason}) — ${filters.startDateStr} → ${filters.endDateStr} on ${basis}`
  );
  console.log('dateRange', {
    start: filters.startDateStr,
    end: filters.endDateStr,
    spanDays: daySpan(filters.startDateStr, filters.endDateStr),
  });
  console.log('dateFilterColumn', filters.arcpDateFilterColumn, `(${basis})`);
  console.log('branch', filters.branchParam || '(all)');
  console.log('franchisee', filters.franchiseeParam || '(all)');
  console.log('callType', filters.callTypeParam || '(all)');
  console.log('dataSource', readArcpFromPostgresClient() ? 'cached' : 'live');
  console.groupEnd();
}

/** Log API response / merged tally after load. */
export function logArcpLoadResult(
  filters: ArcpDebugFilters,
  rows: ArcpClaimsAggregateRow[],
  meta: {
    durationMs: number;
    chunks?: number;
    failedChunks?: number;
    dataSource?: string;
  }
): void {
  if (!arcpBrowserDebugEnabled()) return;

  const basis = dateBasisLabel(filters.arcpDateFilterColumn);
  const summary = summarizeAggregates(rows);
  const empty = rows.length === 0;

  console.groupCollapsed(
    `${LOG_PREFIX} Load result — ${empty ? 'NO ROWS' : `${summary.aggregateRowCount} aggregate rows`} (${filters.startDateStr} → ${filters.endDateStr}, ${basis})`
  );
  console.log('filters', {
    startDate: filters.startDateStr,
    endDate: filters.endDateStr,
    dateFilterColumn: filters.arcpDateFilterColumn,
    dateBasis: basis,
    branch: filters.branchParam || '(all)',
    franchisee: filters.franchiseeParam || '(all)',
    callType: filters.callTypeParam || '(all)',
  });
  console.log('request', {
    dataSource:
      meta.dataSource ??
      (readArcpFromPostgresClient() ? 'cached' : 'live'),
    durationMs: meta.durationMs,
    chunks: meta.chunks ?? 1,
    failedChunks: meta.failedChunks ?? 0,
  });
  if (meta.dataSource === 'crm_fallback') {
    console.info(`${LOG_PREFIX} Supplemental periods merged for this filter.`);
  }
  console.log('dataSummary', summary);
  if (empty) {
    const basis = dateBasisLabel(filters.arcpDateFilterColumn);
    if (isArcpApproveDateColumn(filters.arcpDateFilterColumn)) {
      const col =
        filters.arcpDateFilterColumn === 'bm_approved_at' ? 'bm_approved_at' : 'ho_approved_at';
      console.warn(
        `${LOG_PREFIX} No rows with ${col} in ${filters.startDateStr} → ${filters.endDateStr} (IST). ` +
          'Not the same as Call Date — try BM/HO Call Approved for Feb 2025+ if January is empty.'
      );
    } else {
      console.warn(
        `${LOG_PREFIX} Zero rows for ${basis} in ${filters.startDateStr} → ${filters.endDateStr}.`
      );
    }
  }
  console.groupEnd();
}

/** Log built table model (what the UI actually shows). */
export function logArcpTableModel(
  filters: ArcpDebugFilters,
  model: { rows: unknown[]; totals?: unknown } | null
): void {
  if (!arcpBrowserDebugEnabled() || !model) return;

  console.log(`${LOG_PREFIX} Table model`, {
    dateRange: `${filters.startDateStr} → ${filters.endDateStr}`,
    dateFilterColumn: filters.arcpDateFilterColumn,
    displayRows: model.rows.length,
    totals: model.totals ?? null,
  });
}

function daySpan(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

const DEBUG_INGEST =
  'http://127.0.0.1:7531/ingest/804729da-b15e-49eb-8ace-fd937e48699c';

function emitDebugLog(payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  runId?: string;
}): void {
  // #region agent log
  fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '7888d2',
    },
    body: JSON.stringify({
      sessionId: '7888d2',
      timestamp: Date.now(),
      ...payload,
    }),
  }).catch(() => {});
  // #endregion
}

/** Compare UI summary/table totals vs CSV export model (debug session). */
export function logArcpUiVsCsvTotals(payload: {
  includeTravelReimbursement: boolean;
  rawAggregateCount: number;
  mergedAggregateCount: number;
  mergedRowsSum: {
    amountPayable: number;
    branchApproved: number;
    hoApproved: number;
    qty: number;
  };
  tableModelFromRows: { amountPayable: number; branchApproved: number; hoApproved: number; qty: number };
  tableModelDisplayed: { amountPayable: number; branchApproved: number; hoApproved: number; qty: number };
  fullModelCsv: { amountPayable: number; branchApproved: number; hoApproved: number; qty: number };
  summaryPanel: { amountPayable: number; branchApproved: number; hoApproved: number };
  grandTotalsApi: {
    amountPayable: number;
    branchApproved: number;
    hoApproved: number;
    serviceLineCount: number;
    travelLineCount: number;
  } | null;
  monthlyFromRaw: { amountPayable: number } | null;
  monthlyFromMerged: { amountPayable: number } | null;
  totalsOverriddenByGrandTotals: boolean;
  uiTravelBranchApproved?: number;
  mergedTravelBranchApproved?: number;
}): void {
  const uiSummaryVsCsv = payload.summaryPanel.amountPayable - payload.fullModelCsv.amountPayable;
  const uiTableVsCsv =
    payload.tableModelDisplayed.amountPayable - payload.fullModelCsv.amountPayable;
  const apiGrandVsCsv =
    (payload.grandTotalsApi?.amountPayable ?? 0) - payload.fullModelCsv.amountPayable;
  const apiGrandVsRows =
    (payload.grandTotalsApi?.amountPayable ?? 0) - payload.tableModelFromRows.amountPayable;

  emitDebugLog({
    runId: 'post-fix',
    hypothesisId: 'H1-H2',
    location: 'browser-debug.ts:logArcpUiVsCsvTotals',
    message: 'UI vs CSV amount payable deltas',
    data: {
      uiSummaryVsCsv,
      uiTableVsCsv,
      apiGrandVsCsv,
      apiGrandVsRows,
      totalsOverriddenByGrandTotals: payload.totalsOverriddenByGrandTotals,
      includeTravelReimbursement: payload.includeTravelReimbursement,
    },
  });

  emitDebugLog({
    hypothesisId: 'H3',
    location: 'browser-debug.ts:logArcpUiVsCsvTotals',
    message: 'Monthly breakdown raw vs merged',
    data: {
      monthlyRawAmount: payload.monthlyFromRaw?.amountPayable ?? null,
      monthlyMergedAmount: payload.monthlyFromMerged?.amountPayable ?? null,
      monthlyRawVsMerged:
        (payload.monthlyFromRaw?.amountPayable ?? 0) -
        (payload.monthlyFromMerged?.amountPayable ?? 0),
    },
  });

  emitDebugLog({
    hypothesisId: 'H4-H6',
    location: 'browser-debug.ts:logArcpUiVsCsvTotals',
    message: 'Aggregate row counts and sums',
    data: {
      rawAggregateCount: payload.rawAggregateCount,
      mergedAggregateCount: payload.mergedAggregateCount,
      mergedRowsSum: payload.mergedRowsSum,
      tableModelFromRows: payload.tableModelFromRows,
      fullModelCsv: payload.fullModelCsv,
      summaryPanelBranch: payload.summaryPanel.branchApproved,
      uiTravelBranchApproved: payload.uiTravelBranchApproved ?? null,
      mergedTravelBranchApproved: payload.mergedTravelBranchApproved ?? null,
      rowsExcludedFromTable:
        payload.mergedRowsSum.amountPayable - payload.tableModelFromRows.amountPayable,
    },
  });
}

type ArcpDetailBranchRow = {
  branch_approved?: number | null;
  ho_approved?: number | null;
  line_type?: string | null;
  call_no?: string | null;
  vucnno?: string | null;
  calls2fault_code?: string | null;
  franchisee_code?: string | null;
  raw_nbmapprovedamt?: number | null;
};

function sumDedupedBranch(
  rows: ArcpDetailBranchRow[],
  keyFn: (row: ArcpDetailBranchRow) => string,
  amountFn: (row: ArcpDetailBranchRow) => number
): { rowCount: number; branch: number; travelBranch: number } {
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, row);
  }
  let branch = 0;
  let travelBranch = 0;
  for (const row of map.values()) {
    const amt = amountFn(row);
    branch += amt;
    if (row.line_type === 'Travel') travelBranch += amt;
  }
  return { rowCount: map.size, branch, travelBranch };
}

/** Detail export — compare dedupe keys vs SAP (call-level). */
export function logArcpDetailExportTotals(rows: ArcpDetailBranchRow[]): void {
  if (!arcpBrowserDebugEnabled()) return;

  const exportDeduped = sumDedupedBranch(
    rows,
    (r) => arcpDetailDedupeKey(r as import('./query').ArcpClaimsDetailRow),
    (r) => Number(r.branch_approved) || 0
  );
  const byUcn = sumDedupedBranch(
    rows,
    (r) => {
      const ucn = String(r.vucnno ?? '').trim();
      return ucn ? `ucn:${ucn}` : `fault:${r.calls2fault_code}:${r.franchisee_code}`;
    },
    (r) => Number(r.branch_approved) || 0
  );
  const byRawBm = sumDedupedBranch(
    rows,
    (r) => arcpDetailDedupeKey(r as import('./query').ArcpClaimsDetailRow),
    (r) => Number(r.raw_nbmapprovedamt ?? r.branch_approved) || 0
  );

  emitDebugLog({
    runId: 'sap-align-v6',
    hypothesisId: 'H9-H11',
    location: 'browser-debug.ts:logArcpDetailExportTotals',
    message: 'Detail branch totals by dedupe key',
    data: {
      lineCount: rows.length,
      exportDedupedRows: exportDeduped.rowCount,
      exportBranchApproved: Math.round(exportDeduped.branch * 100) / 100,
      exportTravelBranch: Math.round(exportDeduped.travelBranch * 100) / 100,
      legacyUcnDedupeBranch: Math.round(byUcn.branch * 100) / 100,
      legacyUcnDedupeRows: byUcn.rowCount,
      rawNbmapprovedDedupeBranch: Math.round(byRawBm.branch * 100) / 100,
      sapTargetHint: 26200,
      deltaVsSapExport: Math.round((exportDeduped.branch - 26200) * 100) / 100,
    },
  });
}
