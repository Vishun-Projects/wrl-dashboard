import {
  enrichArcpAggregateLabels,
  enrichArcpDetailRows,
  loadArcpCrmLabelLookups,
} from './crm-labels';
import {
  fetchArcpClaimsAggregates,
  fetchArcpClaimsDetailRows,
  fetchArcpClaimsGrandTotals,
} from './fetch';
import {
  queryArcpClaimsAggregates,
  queryArcpClaimsDetailRows,
  queryArcpClaimsGrandTotals,
} from './postgres';
import {
  deriveArcpGrandTotalsFromAggregates,
  mergeArcpAggregateRows,
  mergeArcpDetailRows,
  planArcpSummaryDateChunks,
  resolveArcpDateFilterColumn,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
  type ArcpClaimsQueryOpts,
  type ArcpGrandTotals,
} from '../query';
import { getArcpPostgresCoverage } from '@/lib/read-model/arcp/coverage-server';
import {
  planArcpCoverageSegments,
  postgresCoversFullRange,
  type ArcpCoverageDateColumn,
} from '@/lib/read-model/arcp/coverage-shared';
import { getArcpReadiness } from '@/lib/read-model/arcp/readiness';
import { readArcpFromPostgres } from '@/lib/read-model/flags';

const CRM_QUERY_TIMEOUT_MS = Number(process.env.ARCP_CRM_LOAD_TIMEOUT_MS ?? 300_000) || 300_000;

export type ArcpDataSource = 'postgres' | 'crm' | 'crm_fallback';

/** When true (default), gaps outside Postgres coverage load live from CRM. */
export function arcpCrmFallbackOnEmptyEnabled(): boolean {
  return process.env.ARCP_CRM_FALLBACK_ON_EMPTY !== 'false';
}

function toCoverageDateColumn(
  column: ReturnType<typeof resolveArcpDateFilterColumn>
): ArcpCoverageDateColumn {
  return column;
}

function emptyGrandTotals(): ArcpGrandTotals {
  return {
    lineCount: 0,
    serviceLineCount: 0,
    travelLineCount: 0,
    amountPayable: 0,
    branchApproved: 0,
    hoApproved: 0,
  };
}

function addGrandTotals(a: ArcpGrandTotals, b: ArcpGrandTotals): ArcpGrandTotals {
  return {
    lineCount: a.lineCount + b.lineCount,
    serviceLineCount: a.serviceLineCount + b.serviceLineCount,
    travelLineCount: a.travelLineCount + b.travelLineCount,
    amountPayable: a.amountPayable + b.amountPayable,
    branchApproved: a.branchApproved + b.branchApproved,
    hoApproved: a.hoApproved + b.hoApproved,
  };
}

async function loadArcpGrandTotalsCoverageAware(
  opts: ArcpClaimsQueryOpts
): Promise<ArcpGrandTotals> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!startDate || !endDate) {
    return queryArcpClaimsGrandTotals(opts);
  }

  const coverage = await getArcpPostgresCoverage();
  const dateColumn = toCoverageDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn));

  if (postgresCoversFullRange(startDate, endDate, coverage, dateColumn)) {
    return queryArcpClaimsGrandTotals(opts);
  }

  const segments = planArcpCoverageSegments(startDate, endDate, coverage, dateColumn);

  let totals = emptyGrandTotals();
  for (const segment of segments) {
    const segOpts: ArcpClaimsQueryOpts = {
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    };
    if (segment.mode === 'postgres') {
      totals = addGrandTotals(totals, await queryArcpClaimsGrandTotals(segOpts));
    } else if (arcpCrmFallbackOnEmptyEnabled()) {
      totals = addGrandTotals(
        totals,
        await fetchArcpClaimsGrandTotals({ ...segOpts, crmUiFast: true }, CRM_QUERY_TIMEOUT_MS)
      );
    }
  }
  return totals;
}

async function loadArcpAggregatesCoverageAware(
  opts: ArcpClaimsQueryOpts
): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
}> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!startDate || !endDate) {
    const rows = await queryArcpClaimsAggregates(opts);
    const grandTotals = deriveArcpGrandTotalsFromAggregates(rows);
    return { aggregates: rows, source: 'postgres', grandTotals };
  }

  const coverage = await getArcpPostgresCoverage();
  const dateColumn = toCoverageDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn));

  if (postgresCoversFullRange(startDate, endDate, coverage, dateColumn)) {
    const aggregates = await queryArcpClaimsAggregates(opts);
    const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
    return { aggregates, source: 'postgres', grandTotals };
  }

  const segments = planArcpCoverageSegments(startDate, endDate, coverage, dateColumn);

  const merged: ArcpClaimsAggregateRow[] = [];
  let usedPostgres = false;
  let usedCrm = false;

  for (const segment of segments) {
    const segOpts: ArcpClaimsQueryOpts = {
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    };

    if (segment.mode === 'postgres') {
      const pgRows = await queryArcpClaimsAggregates(segOpts);
      merged.push(...pgRows);
      usedPostgres = true;
      continue;
    }

    if (!arcpCrmFallbackOnEmptyEnabled()) continue;

    const crmChunks = planArcpSummaryDateChunks({ ...segOpts, crmUiFast: true });
    for (const chunk of crmChunks) {
      const chunkOpts: ArcpClaimsQueryOpts = {
        ...segOpts,
        startDate: chunk.start,
        endDate: chunk.end,
        crmUiFast: true,
      };
      const chunkRows = await fetchArcpClaimsAggregatesFromCrm(chunkOpts, CRM_QUERY_TIMEOUT_MS);
      merged.push(...chunkRows);
    }
    usedCrm = true;
  }

  const aggregates = mergeArcpAggregateRows(merged);
  const source: ArcpDataSource =
    usedPostgres && usedCrm ? 'crm_fallback' : usedCrm ? 'crm_fallback' : 'postgres';

  /* mixed load path — no client logging */

  const grandTotals = deriveArcpGrandTotalsFromAggregates(aggregates);
  return { aggregates, source, grandTotals };
}

async function loadArcpDetailCoverageAware(
  opts: ArcpClaimsQueryOpts
): Promise<{ rows: ArcpClaimsDetailRow[]; source: ArcpDataSource }> {
  const startDate = opts.startDate;
  const endDate = opts.endDate;
  if (!startDate || !endDate) {
    const rows = await queryArcpClaimsDetailRows(opts);
    return { rows, source: 'postgres' };
  }

  const coverage = await getArcpPostgresCoverage();
  const dateColumn = toCoverageDateColumn(resolveArcpDateFilterColumn(opts.dateFilterColumn));
  const segments = planArcpCoverageSegments(startDate, endDate, coverage, dateColumn);

  const merged: ArcpClaimsDetailRow[] = [];
  let usedPostgres = false;
  let usedCrm = false;

  for (const segment of segments) {
    const segOpts: ArcpClaimsQueryOpts = {
      ...opts,
      startDate: segment.start,
      endDate: segment.end,
    };

    if (segment.mode === 'postgres') {
      merged.push(...(await queryArcpClaimsDetailRows(segOpts)));
      usedPostgres = true;
      continue;
    }

    if (!arcpCrmFallbackOnEmptyEnabled()) continue;

    const crmChunks = planArcpSummaryDateChunks(segOpts);
    for (const chunk of crmChunks) {
      const chunkRows = await fetchArcpClaimsDetailRowsFromCrm(
        { ...segOpts, startDate: chunk.start, endDate: chunk.end },
        CRM_QUERY_TIMEOUT_MS
      );
      merged.push(...chunkRows);
    }
    usedCrm = true;
  }

  const rows = mergeArcpDetailRows(merged);
  const source: ArcpDataSource =
    usedPostgres && usedCrm ? 'crm_fallback' : usedCrm ? 'crm_fallback' : 'postgres';

  return { rows, source };
}

async function fetchArcpClaimsAggregatesFromCrm(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
) {
  const [lookups, rows] = await Promise.all([
    loadArcpCrmLabelLookups(),
    fetchArcpClaimsAggregates(opts, timeoutMs),
  ]);
  return enrichArcpAggregateLabels(rows, lookups);
}

async function fetchArcpClaimsDetailRowsFromCrm(
  opts: ArcpClaimsQueryOpts,
  timeoutMs: number
) {
  const [lookups, rows] = await Promise.all([
    loadArcpCrmLabelLookups(),
    fetchArcpClaimsDetailRows(opts, timeoutMs),
  ]);
  return enrichArcpDetailRows(rows, lookups);
}

export async function loadArcpClaimsAggregatesHybrid(
  opts: ArcpClaimsQueryOpts
): Promise<{
  aggregates: ArcpClaimsAggregateRow[];
  source: ArcpDataSource;
  grandTotals: ArcpGrandTotals;
}> {
  if (!readArcpFromPostgres()) {
    const aggregates = await fetchArcpClaimsAggregatesFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return {
      aggregates,
      source: 'crm',
      grandTotals: deriveArcpGrandTotalsFromAggregates(aggregates),
    };
  }

  const readiness = await getArcpReadiness();
  if (!readiness.ready || readiness.rowCount === 0) {
    if (!arcpCrmFallbackOnEmptyEnabled()) {
      const err = new Error(readiness.reason ?? 'ARCP claims data is not ready yet');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }
    /* cache miss — live load */
    const aggregates = await fetchArcpClaimsAggregatesFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return {
      aggregates,
      source: 'crm_fallback',
      grandTotals: deriveArcpGrandTotalsFromAggregates(aggregates),
    };
  }

  return loadArcpAggregatesCoverageAware(opts);
}

export async function loadArcpClaimsDetailRowsHybrid(
  opts: ArcpClaimsQueryOpts
): Promise<{ rows: ArcpClaimsDetailRow[]; source: ArcpDataSource }> {
  if (!readArcpFromPostgres()) {
    const rows = await fetchArcpClaimsDetailRowsFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return { rows, source: 'crm' };
  }

  const readiness = await getArcpReadiness();
  if (!readiness.ready || readiness.rowCount === 0) {
    if (!arcpCrmFallbackOnEmptyEnabled()) {
      const err = new Error(readiness.reason ?? 'ARCP claims data is not ready yet');
      (err as Error & { statusCode?: number }).statusCode = 503;
      throw err;
    }
    const rows = await fetchArcpClaimsDetailRowsFromCrm(opts, CRM_QUERY_TIMEOUT_MS);
    return { rows, source: 'crm_fallback' };
  }

  return loadArcpDetailCoverageAware(opts);
}
