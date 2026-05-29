import {
  ARCP_DATE_FILTER_OPTIONS,
  isArcpApproveDateColumn,
  type ArcpClaimsAggregateRow,
  type ArcpDateFilterColumn,
} from '@/lib/arcp-claims-query';
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
