/**
 * Row-level trace for BD MIS Excel union (CRM + Cadbury + Coke).
 * Each row shows how dashboard counts are built and whether it is included.
 */

import { resolveClientImportPlant } from '@/modules/mis/client-import';
import { formatDisplayRegion } from '@/modules/mis/client-import';
import { isPracticeWinmaxOfficeName } from '@/sql/read-model/summary-call-filters';
import type { StatusBucket } from '@/modules/mis/client-import';
import { clientAccountDisplayName } from '@/modules/mis/services/client-account-display';
import type { BdMisSourceFlags } from '@/modules/mis/services/bd-mis-summary';
import { isRealCancelReasonCode } from '@/modules/mis/services/search';

export type BdMisTraceSource = 'CRM' | 'Cadbury' | 'Coke';

export type BdMisTraceCountsToward = 'total' | 'solved' | 'open' | 'cancelled' | 'none';

export type BdMisCrmCallTraceInput = {
  region: string;
  plant: string | null;
  technician_name: string | null;
  office_under_branch: string | null;
  customer_name: string | null;
  logged_at: Date | string | null;
  service_order: string;
  client: string;
  call_status: string | null;
  status_bucket: StatusBucket;
  ncancelreason?: unknown;
  account: string;
  wco?: string | null;
};

export type BdMisClientCallTraceInput = {
  source_code: string;
  region: string;
  plant: string | null;
  technician_name: string | null;
  office_under_branch: string | null;
  customer_name: string | null;
  logged_at: Date | string | null;
  service_order: string;
  client: string;
  call_status: string | null;
  status_bucket: StatusBucket;
  file_name: string | null;
};

export type BdMisTraceRow = {
  region: string;
  plant: string;
  technician_name: string;
  office_under_branch: string;
  customer_name: string;
  call_date_time: string;
  service_order: string;
  client: string;
  /** W / C / O / V, or — when unknown / client import. */
  wco: string;
  call_status: string;
  aging: string;
  file_name: string;
  source: BdMisTraceSource;
  contribution_step: string;
  included_in_final_count: boolean;
  counts_toward: BdMisTraceCountsToward;
};

function formatTraceWco(raw: string | null | undefined): string {
  const wco = raw != null ? String(raw).trim().toUpperCase() : '';
  return wco === 'W' || wco === 'C' || wco === 'O' || wco === 'V' ? wco : '—';
}

function looksLikeRegionLabel(value: string): boolean {
  const v = value.trim().toUpperCase();
  return (
    v === 'NORTH' ||
    v === 'EAST' ||
    v === 'WEST' ||
    v === 'SOUTH' ||
    v === 'NORTH ZONE' ||
    v === 'EAST ZONE' ||
    v === 'WEST ZONE' ||
    v === 'SOUTH ZONE' ||
    v === 'NORTH REGION' ||
    v === 'EAST REGION' ||
    v === 'WEST REGION' ||
    v === 'SOUTH REGION' ||
    v === 'OTHER'
  );
}

function cleanBranchLikeValue(value: string | null | undefined): string {
  const text = value?.trim() || '';
  if (!text) return '—';
  if (looksLikeRegionLabel(text)) return '—';
  return text;
}

function isCrmCadburyAccount(account: string): boolean {
  const key = account.trim().toLowerCase();
  return key === 'cadbury' || key === 'mondelez';
}

/** CRM Cadbury/Mondelez from CRM Files — replaced by Mondelez import in the union. */
export function isCrmCadburyCrmFileTraceRow(row: BdMisTraceRow): boolean {
  if (row.source !== 'CRM' || row.file_name !== 'CRM Files') return false;
  return isCrmCadburyAccount(row.client);
}

function crmRowIsCadburyUnionExcluded(
  row: BdMisCrmCallTraceInput,
  zone: string,
  sources: BdMisSourceFlags
): boolean {
  if (!sources.crm) return false;
  if (!(sources.cadbury || sources.excludeCrmCadbury === true)) return false;
  if (!sources.excludeCrmCadbury && zone === 'WEST ZONE') return false;
  return isCrmCadburyAccount(row.account) || isCrmCadburyAccount(row.client);
}

function isCadburyClientAccount(account: string): boolean {
  return account.trim().toLowerCase() === 'cadbury';
}

function isCokeClientAccount(account: string): boolean {
  return account.trim().toLowerCase() === 'coke';
}

function traceSourceFromCode(code: string): BdMisTraceSource {
  const key = code.trim().toLowerCase();
  if (key === 'cadbury') return 'Cadbury';
  if (key === 'coke') return 'Coke';
  return 'CRM';
}

export function traceFileDisplayName(source: BdMisTraceSource, batchFileName?: string | null): string {
  if (source === 'CRM') return 'CRM Files';
  if (source === 'Cadbury') return 'Mondelez Files';
  if (source === 'Coke') return 'HCCB Files';
  return batchFileName?.trim() || '';
}

export function traceClientDisplayName(source: BdMisTraceSource, account: string): string {
  if (source === 'Cadbury') return clientAccountDisplayName('cadbury');
  if (source === 'Coke') return clientAccountDisplayName('coke');
  return account.trim() || '—';
}

export function dayDiffFromAgingDate(
  loggedAt: Date | string | null,
  agingDate: string
): number | null {
  if (!loggedAt) return null;
  const callDate = loggedAt instanceof Date ? loggedAt : new Date(loggedAt);
  if (Number.isNaN(callDate.getTime())) return null;
  const aging = new Date(`${agingDate}T23:59:59`);
  const startUtc = Date.UTC(callDate.getFullYear(), callDate.getMonth(), callDate.getDate());
  const endUtc = Date.UTC(aging.getFullYear(), aging.getMonth(), aging.getDate());
  return Math.floor((endUtc - startUtc) / 86400000);
}

export function formatAgingLabel(
  dayDiff: number | null,
  statusBucket: StatusBucket
): string {
  if (statusBucket === 'cancelled') return 'Cancelled';
  if (statusBucket === 'solved' || statusBucket === 'tech_solved') return '';
  if (dayDiff == null) return '—';
  if (dayDiff <= 2) return '<2 days';
  if (dayDiff <= 7) return '3-7 days';
  if (dayDiff <= 15) return '8-15 days';
  return '>15 days';
}

function formatTraceCallDate(value: Date | string | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function displayCallStatus(
  status: string | null,
  statusBucket: StatusBucket,
  ncancelreason?: unknown
): string {
  if (statusBucket === 'cancelled' || isRealCancelReasonCode(ncancelreason)) {
    return 'Cancelled';
  }
  const label = status?.trim();
  if (!label) return '—';
  if (label.toLowerCase().includes('cancel')) return 'Cancelled';
  return label;
}

function countsTowardFromBucket(bucket: StatusBucket): BdMisTraceCountsToward {
  if (bucket === 'cancelled') return 'cancelled';
  if (bucket === 'solved' || bucket === 'tech_solved') return 'solved';
  if (bucket === 'open_unallocated' || bucket === 'assigned') return 'open';
  return 'total';
}

function classifyCrmContribution(
  row: BdMisCrmCallTraceInput,
  sources: BdMisSourceFlags
): Pick<BdMisTraceRow, 'contribution_step' | 'included_in_final_count' | 'counts_toward'> {
  const zone = formatDisplayRegion(row.region);
  const bucket = row.status_bucket;

  if (bucket === 'cancelled') {
    return {
      contribution_step: 'CRM — cancelled (excluded from total)',
      included_in_final_count: false,
      counts_toward: 'cancelled',
    };
  }

  if (!sources.crm) {
    return {
      contribution_step: 'CRM source off',
      included_in_final_count: false,
      counts_toward: 'none',
    };
  }

  if (crmRowIsCadburyUnionExcluded(row, zone, sources)) {
    return {
      contribution_step: sources.cadbury
        ? '2. − CRM Cadbury/Mondelez (replaced by Cadbury import)'
        : '2. − CRM Cadbury/Mondelez (excluded from MIS mail)',
      included_in_final_count: false,
      counts_toward: 'none',
    };
  }

  return {
    contribution_step: '1. CRM branch base (included)',
    included_in_final_count: true,
    counts_toward: countsTowardFromBucket(bucket),
  };
}

function classifyClientContribution(
  row: BdMisClientCallTraceInput,
  sources: BdMisSourceFlags
): Pick<BdMisTraceRow, 'contribution_step' | 'included_in_final_count' | 'counts_toward' | 'region'> {
  const source = traceSourceFromCode(row.source_code);
  const zone = formatDisplayRegion(row.region);
  const bucket = row.status_bucket;
  const displayRegion =
    source === 'Coke' && sources.coke ? 'SOUTH ZONE' : zone;

  if (bucket === 'cancelled') {
    return {
      region: displayRegion,
      contribution_step: `${source} import — cancelled`,
      included_in_final_count: false,
      counts_toward: 'cancelled',
    };
  }

  if (source === 'Cadbury') {
    if (!sources.cadbury) {
      return {
        region: displayRegion,
        contribution_step: 'Cadbury source off',
        included_in_final_count: false,
        counts_toward: 'none',
      };
    }
    if (zone === 'WEST ZONE') {
      return {
        region: displayRegion,
        contribution_step: 'Cadbury import — West excluded from formula',
        included_in_final_count: false,
        counts_toward: 'none',
      };
    }
    if (!isCadburyClientAccount(row.client)) {
      return {
        region: displayRegion,
        contribution_step: 'Cadbury import — not Cadbury account',
        included_in_final_count: false,
        counts_toward: 'none',
      };
    }
    return {
      region: displayRegion,
      contribution_step: '3. + Client Cadbury (Mondelez file)',
      included_in_final_count: true,
      counts_toward: countsTowardFromBucket(bucket),
    };
  }

  if (source === 'Coke') {
    if (!sources.coke) {
      return {
        region: displayRegion,
        contribution_step: 'Coke source off',
        included_in_final_count: false,
        counts_toward: 'none',
      };
    }
    if (!isCokeClientAccount(row.client)) {
      return {
        region: displayRegion,
        contribution_step: 'Coke import — not Coke account',
        included_in_final_count: false,
        counts_toward: 'none',
      };
    }
    return {
      region: displayRegion,
      contribution_step: '5. + Client Coke (HCCB file → South)',
      included_in_final_count: true,
      counts_toward: countsTowardFromBucket(bucket),
    };
  }

  return {
    region: displayRegion,
    contribution_step: 'Client import — not used in BD MIS formula',
    included_in_final_count: false,
    counts_toward: 'none',
  };
}

export function mapCrmCallToTraceRow(
  row: BdMisCrmCallTraceInput,
  sources: BdMisSourceFlags,
  agingDate: string
): BdMisTraceRow {
  const source: BdMisTraceSource = 'CRM';
  const contribution = classifyCrmContribution(row, sources);
  const dayDiff = dayDiffFromAgingDate(row.logged_at, agingDate);

  return {
    region: formatDisplayRegion(row.region),
    plant: cleanBranchLikeValue(row.plant),
    technician_name: row.technician_name?.trim() || '—',
    office_under_branch: cleanBranchLikeValue(row.office_under_branch),
    customer_name: row.customer_name?.trim() || '—',
    call_date_time: formatTraceCallDate(row.logged_at),
    service_order: row.service_order.trim() || '—',
    client: traceClientDisplayName(source, row.client),
    wco: formatTraceWco(row.wco),
    call_status: displayCallStatus(row.call_status, row.status_bucket, row.ncancelreason),
    aging: formatAgingLabel(dayDiff, row.status_bucket),
    file_name: traceFileDisplayName(source),
    source,
    ...contribution,
  };
}

export function mapClientCallToTraceRow(
  row: BdMisClientCallTraceInput,
  sources: BdMisSourceFlags,
  agingDate: string
): BdMisTraceRow {
  const source = traceSourceFromCode(row.source_code);
  const contribution = classifyClientContribution(row, sources);
  const dayDiff = dayDiffFromAgingDate(row.logged_at, agingDate);

  const mappedPlant =
    resolveClientImportPlant(row.plant);

  return {
    plant: mappedPlant ? cleanBranchLikeValue(mappedPlant) : '—',
    technician_name: row.technician_name?.trim() || '—',
    office_under_branch: cleanBranchLikeValue(row.office_under_branch),
    customer_name: row.customer_name?.trim() || '—',
    call_date_time: formatTraceCallDate(row.logged_at),
    service_order: row.service_order.trim() || '—',
    client: traceClientDisplayName(source, row.client),
    wco: '—',
    call_status: displayCallStatus(row.call_status, row.status_bucket),
    aging: formatAgingLabel(dayDiff, row.status_bucket),
    file_name: traceFileDisplayName(source, row.file_name),
    source,
    ...contribution,
  };
}

export function buildBdMisTraceRows(params: {
  crmRows: BdMisCrmCallTraceInput[];
  clientRows: BdMisClientCallTraceInput[];
  sources: BdMisSourceFlags;
  agingDate: string;
}): BdMisTraceRow[] {
  const { crmRows, clientRows, sources, agingDate } = params;
  const traceRows: BdMisTraceRow[] = [];

  for (const row of crmRows) {
    traceRows.push(mapCrmCallToTraceRow(row, sources, agingDate));
  }
  for (const row of clientRows) {
    traceRows.push(mapClientCallToTraceRow(row, sources, agingDate));
  }

  return traceRows.sort((a, b) => {
    const regionCmp = a.region.localeCompare(b.region);
    if (regionCmp !== 0) return regionCmp;
    const fileCmp = a.file_name.localeCompare(b.file_name);
    if (fileCmp !== 0) return fileCmp;
    return a.service_order.localeCompare(b.service_order);
  });
}

/** Row detail export excludes cancelled calls. */
export function filterTraceRowsForExport(traceRows: BdMisTraceRow[]): BdMisTraceRow[] {
  return traceRows.filter((row) => {
    if (row.counts_toward === 'cancelled') return false;
    if (isExcludedMisBranchTraceRow(row)) return false;
    return true;
  });
}

function isExcludedMisBranchTraceRow(row: BdMisTraceRow): boolean {
  return (
    isPracticeWinmaxOfficeName(row.plant) ||
    isPracticeWinmaxOfficeName(row.office_under_branch)
  );
}

/**
 * MIS email / summary-aligned export: included rows only, minus CRM Cadbury from CRM Files.
 * All other clients keep open, closed, solved, and tech-solved detail.
 */
export function filterTraceRowsForSummaryExport(traceRows: BdMisTraceRow[]): BdMisTraceRow[] {
  return traceRows.filter((row) => {
    if (row.counts_toward === 'cancelled') return false;
    if (isCrmCadburyCrmFileTraceRow(row)) return false;
    if (isExcludedMisBranchTraceRow(row)) return false;
    if (!row.included_in_final_count) return false;
    return true;
  });
}

/** Open-calls export: included rows only (assigned + open_unallocated). */
export function filterTraceRowsForOpenExport(traceRows: BdMisTraceRow[]): BdMisTraceRow[] {
  return traceRows.filter((row) => {
    if (isCrmCadburyCrmFileTraceRow(row)) return false;
    if (isExcludedMisBranchTraceRow(row)) return false;
    return row.included_in_final_count && row.counts_toward === 'open';
  });
}

/** Open calls in trace detail (assigned + open_unallocated, included in final count). */
export function countTraceOpenCalls(traceRows: BdMisTraceRow[]): number {
  return traceRows.filter((row) => row.included_in_final_count && row.counts_toward === 'open')
    .length;
}
