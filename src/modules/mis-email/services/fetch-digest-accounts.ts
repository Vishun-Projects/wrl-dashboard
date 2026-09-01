import { queryClientAccountSummaryFiltered } from '@/modules/mis/client-import/server';
import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import { MIS_EMAIL_CLIENT_SOURCE_CODES } from '@/modules/mis-email/services/source-codes';
import {
  buildAccountDisplayRows,
  filterKeyAccountRows,
  listAvailableKeyAccounts,
  zoneKey,
  type MergeSelection,
} from '@/modules/mis';
import type { MisEmailKeyAccountsByZone } from '@/modules/mis-email/services/preferences';
import { accountsMatchDisplayOrKey } from '@/modules/mis';
import type { AccountSummaryRow } from '@/lib/summary/derive';

const DIGEST_MERGE_FLAGS: MergeSelection = {
  crm: true,
  client: true,
};

export async function fetchDigestClientAccountSummary(
  dateRange: DigestDateRange,
  sourceCodes: string[] = [...MIS_EMAIL_CLIENT_SOURCE_CODES]
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

/** True when account matches any picker/body selection (aliases included). */
export function accountMatchesDigestSelection(
  account: string,
  selectedAccounts: string[]
): boolean {
  if (!selectedAccounts.length) return true;
  return selectedAccounts.some((selected) => accountsMatchDisplayOrKey(selected, account));
}

/** Narrow account-summary / row lists to selected clients. Empty selection = no filter. */
export function filterRowsByDigestAccounts<T extends { account?: string | null }>(
  rows: T[],
  selectedAccounts: string[]
): T[] {
  if (!selectedAccounts.length) return rows;
  return rows.filter((row) =>
    accountMatchesDigestSelection(String(row.account ?? ''), selectedAccounts)
  );
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
  explicitSelection: string[],
  byZoneSelection?: MisEmailKeyAccountsByZone
): Array<Record<string, unknown>> {
  const zoneSelections = byZoneSelection ?? {};
  const hasPerZoneSelection = Object.values(zoneSelections).some((values) => (values ?? []).length > 0);
  if (hasPerZoneSelection) {
    const rows = buildDigestAccountDisplayRows(crmAccounts, clientAccounts);
    return rows.filter((row) => {
      const region = String(row.region ?? '');
      const account = String(row.account ?? '').trim();
      if (!account) return false;
      const zone = zoneKey(region) as keyof MisEmailKeyAccountsByZone;
      const picks = zoneSelections[zone] ?? [];
      // Empty zone list means "none from this zone" — not "all accounts".
      if (!picks.length) return false;
      return picks.some((selected) => accountsMatchDisplayOrKey(selected, account));
    });
  }

  const accountNames = resolveDigestKeyAccountNames(
    crmAccounts,
    clientAccounts,
    explicitSelection
  );
  if (!accountNames.length) return [];
  const rows = filterDigestKeyAccountRows(crmAccounts, clientAccounts, accountNames);
  if (rows.length > 0) return rows;

  // If saved selections are stale for this period, fall back to all accounts
  // so the key-account section is never blank unexpectedly.
  if (explicitSelection.length > 0) {
    const allNames = listDigestAvailableKeyAccounts(crmAccounts, clientAccounts);
    if (!allNames.length) return [];
    return filterDigestKeyAccountRows(crmAccounts, clientAccounts, allNames);
  }

  return [];
}
