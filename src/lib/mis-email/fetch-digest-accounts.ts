import { DEFAULT_MIS_SOURCE_SELECTION } from '@/lib/mis-client-import/source-selection';
import { queryClientAccountSummaryFiltered } from '@/lib/mis-client-import/aggregate';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import type { UserDigestScope } from '@/lib/mis-email/user-scope';
import {
  buildAccountDisplayRows,
  filterKeyAccountRows,
  listAvailableKeyAccounts,
  type MergeSelection,
} from '@/lib/report/account-merge';
import type { AccountSummaryRow } from '@/lib/report/summary-derive';

const DIGEST_MERGE_FLAGS: MergeSelection = {
  crm: true,
  client: true,
};

export async function fetchDigestClientAccountSummary(
  dateRange: DigestDateRange,
  sourceCodes: string[] = DEFAULT_MIS_SOURCE_SELECTION.clientSourceCodes
): Promise<AccountSummaryRow[]> {
  return queryClientAccountSummaryFiltered({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    agingAsOf: dateRange.endDate,
    sourceCodes,
  });
}

export function buildDigestAccountDisplayRows(
  crmAccounts: AccountSummaryRow[],
  clientAccounts: AccountSummaryRow[] | undefined
): Array<Record<string, unknown>> {
  return buildAccountDisplayRows(
    crmAccounts as Array<Record<string, unknown>>,
    clientAccounts as Array<Record<string, unknown>> | undefined,
    DIGEST_MERGE_FLAGS
  );
}

export function listDigestAvailableKeyAccounts(
  crmAccounts: AccountSummaryRow[],
  clientAccounts: AccountSummaryRow[] | undefined
): string[] {
  const rows = buildDigestAccountDisplayRows(crmAccounts, clientAccounts);
  return listAvailableKeyAccounts(rows);
}

export function filterDigestKeyAccountRows(
  crmAccounts: AccountSummaryRow[],
  clientAccounts: AccountSummaryRow[] | undefined,
  selectedAccounts: string[]
): Array<Record<string, unknown>> {
  const rows = buildDigestAccountDisplayRows(crmAccounts, clientAccounts);
  return filterKeyAccountRows(rows, selectedAccounts);
}

/** When no accounts are explicitly selected, include all merged accounts (same as Key Account MIS tab). */
export function resolveDigestKeyAccountNames(
  crmAccounts: AccountSummaryRow[],
  clientAccounts: AccountSummaryRow[] | undefined,
  explicitSelection: string[]
): string[] {
  if (explicitSelection.length > 0) return explicitSelection;
  return listDigestAvailableKeyAccounts(crmAccounts, clientAccounts);
}

export function resolveDigestKeyAccountBodyRows(
  crmAccounts: AccountSummaryRow[],
  clientAccounts: AccountSummaryRow[] | undefined,
  explicitSelection: string[]
): Array<Record<string, unknown>> {
  const accountNames = resolveDigestKeyAccountNames(
    crmAccounts,
    clientAccounts,
    explicitSelection
  );
  if (!accountNames.length) return [];
  return filterDigestKeyAccountRows(crmAccounts, clientAccounts, accountNames);
}

/** @deprecated scope reserved for future office-level client import filtering */
export type DigestAccountScope = UserDigestScope;
