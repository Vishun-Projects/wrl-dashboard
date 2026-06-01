import 'server-only';

import { postQuery } from '@/lib/db-proxy';
import { resolveReportSecurity, type ReportSecurity } from '@/lib/auth/report-security';
import {
  aggregateByBranch,
  analyzeListTierRows,
  buildLocationAuditRawSql,
  buildLocationAuditRowSql,
  buildLocationAuditVisitSql,
  enrichDetailTier,
  filterLocationAuditListRows,
  LOCATION_AUDIT_MAX_ROWS,
  summarizeLocationAuditListRows,
  type LocationAuditDetailRow,
  type LocationAuditListRow,
  type LocationAuditQueryParams,
} from '@/lib/location-audit';
import { analyzeListTierFromRaw } from '@/lib/location-audit/analyze';
import { enrichTrhcallBranchFranchisee, resolveRegisterDateSqlColumn } from '@/lib/trhcalls-query';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/lib/report-filters';

const QUERY_TIMEOUT_MS = 300_000;
const ROW_TIMEOUT_MS = 60_000;

export type LocationAuditSecurity = ReportSecurity;

/** @deprecated Use resolveReportSecurity */
export const resolveLocationAuditSecurity = resolveReportSecurity;

export function parseLocationAuditQueryParams(
  searchParams: URLSearchParams,
  security: LocationAuditSecurity
): { error?: string; params?: LocationAuditQueryParams & { callType: string } } {
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  if (!startDate || !endDate) {
    return { error: 'startDate and endDate are required' };
  }

  const callTypeParam = searchParams.get('callType');
  const callType =
    callTypeParam && callTypeParam !== 'All' ? callTypeParam : SUMMARY_DEFAULT_CALL_TYPE;

  return {
    params: {
      startDate,
      endDate,
      callType,
      officeId: searchParams.get('officeId'),
      franchisee: searchParams.get('franchisee'),
      branch: searchParams.get('branch'),
      technician: searchParams.get('technician'),
      pincode: searchParams.get('pincode'),
      state: searchParams.get('state'),
      city: searchParams.get('city'),
      isHod: security.isHod,
      assignedOffices: security.assignedOffices,
      dateColumn: resolveRegisterDateSqlColumn(searchParams.get('dateFilterColumn')),
      limit: LOCATION_AUDIT_MAX_ROWS,
    },
  };
}

async function fetchCrmSql(rawSql: string, timeoutMs = QUERY_TIMEOUT_MS) {
  const res = await postQuery({ rawSql, timeoutMs });
  return ((res.data || []) as Record<string, unknown>[]).map((row) =>
    enrichTrhcallBranchFranchisee(row)
  );
}

export async function fetchLocationAuditCrmRows(params: LocationAuditQueryParams) {
  return fetchCrmSql(buildLocationAuditRawSql(params));
}

export async function fetchLocationAuditSummary(params: LocationAuditQueryParams) {
  const rawRows = await fetchCrmSql(buildLocationAuditRawSql(params));
  const analyzed = analyzeListTierRows(rawRows);
  const rows = filterLocationAuditListRows(analyzed, { pincodeMismatchOnly: true });
  const summary = summarizeLocationAuditListRows(rows, LOCATION_AUDIT_MAX_ROWS);
  const byBranch = aggregateByBranch(rows);
  return { summary, byBranch, analyzedCount: analyzed.length };
}

/** Full list for the date/filter window (up to {@link LOCATION_AUDIT_MAX_ROWS}), pincode mismatches only. */
export async function fetchLocationAuditList(
  params: LocationAuditQueryParams,
  _opts?: { mismatchesOnly?: boolean }
) {
  const rawRows = await fetchCrmSql(buildLocationAuditRawSql(params));
  const analyzed = analyzeListTierRows(rawRows);
  const rows = filterLocationAuditListRows(analyzed, { pincodeMismatchOnly: true });
  return { rows, total: rows.length };
}

/** @deprecated Use {@link fetchLocationAuditList} */
export const fetchLocationAuditListPage = fetchLocationAuditList;

export async function fetchLocationAuditRowDetail(
  ncode: string,
  officeId: string,
  security: Pick<LocationAuditSecurity, 'isHod' | 'assignedOffices'>
): Promise<LocationAuditDetailRow | null> {
  const rawSql = buildLocationAuditRowSql(ncode, officeId, security);
  const rows = await fetchCrmSql(rawSql, ROW_TIMEOUT_MS);
  if (rows.length === 0) return null;

  const list = analyzeListTierFromRaw(rows[0]);
  const visitSql = buildLocationAuditVisitSql(ncode, officeId);
  const visitRes = await postQuery({ rawSql: visitSql, timeoutMs: ROW_TIMEOUT_MS });
  const visitRows = (visitRes.data || []) as Record<string, unknown>[];
  const visit = visitRows[0] ?? null;

  return enrichDetailTier(list, visit);
}

export async function runLocationAuditExport(
  params: LocationAuditQueryParams,
  _opts?: { mismatchesOnly?: boolean }
): Promise<LocationAuditDetailRow[]> {
  const rawRows = await fetchCrmSql(buildLocationAuditRawSql(params));
  const listRows = analyzeListTierRows(rawRows);
  const filtered = filterLocationAuditListRows(listRows, { pincodeMismatchOnly: true });

  const details: LocationAuditDetailRow[] = [];
  for (const list of filtered) {
    if (!list.ncode || !list.officeId) {
      details.push(enrichDetailTier(list, null));
      continue;
    }
    try {
      const visitSql = buildLocationAuditVisitSql(list.ncode, list.officeId);
      const visitRes = await postQuery({ rawSql: visitSql, timeoutMs: ROW_TIMEOUT_MS });
      const visitRows = (visitRes.data || []) as Record<string, unknown>[];
      details.push(enrichDetailTier(list, visitRows[0] ?? null));
    } catch {
      details.push(enrichDetailTier(list, null));
    }
  }
  return details;
}

/** @deprecated Monolithic analysis */
export function runLocationAuditAnalysis(rawRows: Record<string, unknown>[]) {
  const rows = analyzeListTierRows(rawRows);
  const summary = summarizeLocationAuditListRows(rows, LOCATION_AUDIT_MAX_ROWS);
  const byBranch = aggregateByBranch(rows);
  return { rows, summary, byBranch };
}
