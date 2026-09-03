import { formatDisplayRegion } from '@/modules/mis/client-import';
import {
  accountsMatchDisplayOrKey,
  clientAccountDisplayName,
} from '@/modules/mis/services/client-account-display';
import type { MisSourceSelection } from '@/modules/mis/client-import';

export type MergeSelection = { crm: boolean; client: boolean };

export function mergeFlagsFromSelection(selection: MisSourceSelection): MergeSelection {
  return {
    crm: selection.crm,
    client: selection.clientSourceCodes.length > 0,
  };
}

export type ClientMergeWithCrmPrefs = {
  cadbury: boolean;
  coke: boolean;
};

export const DEFAULT_CLIENT_MERGE_WITH_CRM: ClientMergeWithCrmPrefs = {
  cadbury: false,
  coke: false,
};

/** Cadbury import + CRM Mondelez alias (same Key Account / open-export treatment). */
export function isCadburyAccount(account: string): boolean {
  const key = account.trim().toLowerCase();
  return key === 'cadbury' || key === 'mondelez';
}

/** Coke import + CRM HCCB alias. */
export function isCokeAccount(account: string): boolean {
  const key = account.trim().toLowerCase();
  return key === 'coke' || key === 'hccb';
}

/** Coke / Cadbury client-import rows on Key Account (incl. CRM display aliases). */
export function isClientImportAccount(account: string): boolean {
  return isCadburyAccount(account) || isCokeAccount(account);
}

function mergeWithCrmForAccount(account: string, prefs: ClientMergeWithCrmPrefs): boolean {
  if (isCadburyAccount(account)) return prefs.cadbury;
  if (isCokeAccount(account)) return prefs.coke;
  return false;
}

/** Per-account merge flags — client-import accounts default to import-only unless merge-with-CRM is enabled. */
export function accountMergeFlags(
  account: string,
  globalFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs
): MergeSelection {
  if (!isClientImportAccount(account)) return globalFlags;
  if (mergeWithCrmForAccount(account, clientMergeWithCrm)) return globalFlags;
  return { crm: false, client: globalFlags.client };
}

export function zoneKey(region: string): string {
  return region.toUpperCase().replace(/\s*ZONE\s*$/i, '').trim();
}

function regionsMatch(crmRegion: string, clientRegion: string): boolean {
  const r = zoneKey(crmRegion);
  const c = zoneKey(clientRegion);
  if (!r || !c) return false;
  return r === c;
}

function accountsMatch(crmAccount: string, clientAccount: string): boolean {
  return accountsMatchDisplayOrKey(crmAccount, clientAccount);
}

/** One row per zone+display alias (Cadbury/Mondelez, Coke/HCCB). */
function accountDisplayMergeKey(account: string): string {
  return clientAccountDisplayName(account).toLowerCase();
}

function resolveClientAccountField(field: string): string {
  if (field === 'solved_calls') return 'total_solved';
  return field;
}

export function mergeSelectedMetrics(
  crm: number,
  client: number,
  selection: MergeSelection
): number {
  if (!selection.crm && !selection.client) return 0;
  if (!selection.crm && selection.client) return client;
  if (selection.crm && !selection.client) return crm;
  return crm + client;
}

export function mergedMetricValue(
  crm: number,
  client: number,
  includeClientImport = true
): number {
  return mergeSelectedMetrics(crm, client, {
    crm: true,
    client: includeClientImport && client > 0,
  });
}

export function findAccountMetric(
  accounts: Array<Record<string, unknown>> | undefined,
  region: string,
  account: string,
  field: string
): number {
  if (!accounts?.length) return 0;
  const clientField = resolveClientAccountField(field);
  return accounts
    .filter((a) => {
      if (!regionsMatch(region, String(a.region ?? ''))) return false;
      return accountsMatch(account, String(a.account ?? ''));
    })
    .reduce((sum, a) => sum + Number(a[clientField] ?? 0), 0);
}

export function findAccountMetricByAccount(
  accounts: Array<Record<string, unknown>> | undefined,
  account: string,
  field: string
): number {
  if (!accounts?.length) return 0;
  const clientField = resolveClientAccountField(field);
  return accounts
    .filter((a) => accountsMatch(account, String(a.account ?? '')))
    .reduce((sum, a) => sum + Number(a[clientField] ?? 0), 0);
}

export function accountRowScore(
  row: Record<string, unknown>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs
): number {
  const account = String(row.account ?? '');
  const region = String(row.region ?? '');
  const flags = accountMergeFlags(account, globalMergeFlags, clientMergeWithCrm);
  const client = findAccountMetric(clientAccounts, region, account, 'total_calls');
  return mergeSelectedMetrics(Number(row.total_calls ?? 0), client, flags);
}

export const DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS = ['DEALER', 'GENERAL'];

export function isAccountExcludedFromZoneTop(
  account: string,
  excludeAccounts: string[]
): boolean {
  if (!excludeAccounts.length) return false;
  const key = account.trim().toLowerCase();
  return excludeAccounts.some((e) => e.trim().toLowerCase() === key);
}

/** Keep top N accounts per zone, ranked by scoreFn (higher first). */
export function filterTopAccountsByZone(
  accounts: Array<Record<string, unknown>>,
  topN: number,
  scoreFn: (row: Record<string, unknown>) => number,
  excludeAccounts: string[] = []
): Array<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(100, Math.floor(topN) || 1));
  const eligible = excludeAccounts.length
    ? accounts.filter(
        (row) => !isAccountExcludedFromZoneTop(String(row.account ?? ''), excludeAccounts)
      )
    : accounts;
  const byRegion = new Map<string, Array<Record<string, unknown>>>();
  for (const row of eligible) {
    const rk = zoneKey(String(row.region ?? ''));
    if (!byRegion.has(rk)) byRegion.set(rk, []);
    byRegion.get(rk)!.push(row);
  }
  const result: Array<Record<string, unknown>> = [];
  for (const rk of [...byRegion.keys()].sort()) {
    const rows = byRegion.get(rk)!;
    const sorted = [...rows].sort((a, b) => {
      const diff = scoreFn(b) - scoreFn(a);
      if (diff !== 0) return diff;
      return String(a.account ?? '').localeCompare(String(b.account ?? ''));
    });
    result.push(...sorted.slice(0, limit));
  }
  return result;
}

export function sumMergedAccountMetric(
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  field: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  byAccountOnly = false
): number {
  return accounts.reduce((sum, a) => {
    const account = String(a.account ?? '');
    const region = String(a.region ?? '');
    const flags = accountMergeFlags(account, globalMergeFlags, clientMergeWithCrm);
    const client = byAccountOnly
      ? findAccountMetricByAccount(clientAccounts, account, field)
      : findAccountMetric(clientAccounts, region, account, field);
    return sum + mergeSelectedMetrics(Number(a[field] ?? 0), client, flags);
  }, 0);
}

export function buildAccountDisplayRows(
  crmAccounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  selection: MergeSelection | boolean
): Array<Record<string, unknown>> {
  const flags =
    typeof selection === 'boolean' ? { crm: true, client: selection } : selection;

  if (!flags.client && flags.crm) return crmAccounts;
  if (flags.client && !flags.crm) return buildClientOnlyAccountRows(clientAccounts);

  if (!clientAccounts?.length) return crmAccounts;
  // Collapse CRM Cadbury/Mondelez (and Coke/HCCB) onto one display key so import
  // metrics attach once — same treatment as open-calls export.
  const rows: Array<Record<string, unknown>> = [];
  const keys = new Set<string>();
  for (const a of crmAccounts) {
    const key = `${zoneKey(String(a.region ?? ''))}::${accountDisplayMergeKey(String(a.account ?? ''))}`;
    if (keys.has(key)) continue;
    keys.add(key);
    rows.push(a);
  }
  for (const clientRow of clientAccounts) {
    const key = `${zoneKey(String(clientRow.region ?? ''))}::${accountDisplayMergeKey(String(clientRow.account ?? ''))}`;
    if (keys.has(key)) continue;
    rows.push({
      region: formatDisplayRegion(String(clientRow.region ?? '')),
      account: clientRow.account,
      population: 0,
      total_calls: 0,
      total_solved: 0,
      cancelled_calls: 0,
      open_calls: 0,
      age_2: 0,
      age_3: 0,
      age_7: 0,
      age_15: 0,
      part_pending: 0,
      deployment_total: 0,
      deployment_done: 0,
      installation_total: 0,
      installation_done: 0,
      active_eng: 0,
      headcount: 0,
      total_tech_solved: 0,
      _clientOnly: true,
    });
    keys.add(key);
  }
  return rows;
}

export function buildClientOnlyAccountRows(
  clientAccounts: Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> {
  if (!clientAccounts?.length) return [];
  return clientAccounts.map((a) => ({
    region: formatDisplayRegion(String(a.region ?? '')),
    account: a.account,
    population: Number(a.population ?? 0),
    total_calls: Number(a.total_calls ?? 0),
    total_solved: Number(a.total_solved ?? 0),
    cancelled_calls: Number(a.cancelled_calls ?? 0),
    open_calls: Number(a.open_calls ?? 0),
    age_2: Number(a.age_2 ?? 0),
    age_3: Number(a.age_3 ?? 0),
    age_7: Number(a.age_7 ?? 0),
    age_15: Number(a.age_15 ?? 0),
    part_pending: Number(a.part_pending ?? 0),
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: Number(a.active_eng ?? 0),
    headcount: 0,
    total_tech_solved: 0,
    _clientOnly: true,
  }));
}

/** CRM + client grand totals — includes client-only account rows (same row set as Key Account MIS). */
export function sumMergedGrandMetric(
  crmAccounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  field: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  accountRowsOverride?: Array<Record<string, unknown>>
): number {
  const rows =
    accountRowsOverride ??
    (globalMergeFlags.client
      ? buildAccountDisplayRows(crmAccounts, clientAccounts, globalMergeFlags)
      : crmAccounts);
  return sumMergedAccountMetric(
    rows,
    clientAccounts,
    field,
    globalMergeFlags,
    clientMergeWithCrm
  );
}

function accountsInRegion(
  accounts: Array<Record<string, unknown>>,
  region: string
): Array<Record<string, unknown>> {
  return accounts.filter((a) => regionsMatch(region, String(a.region ?? '')));
}

export function sumMergedAccountMetricByRegion(
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  region: string,
  field: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs
): number {
  return sumMergedAccountMetric(
    accountsInRegion(accounts, region),
    clientAccounts,
    field,
    globalMergeFlags,
    clientMergeWithCrm
  );
}

export function sumMergedGrandOpenCalls(
  crmAccounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  accountRowsOverride?: Array<Record<string, unknown>>
): number {
  return sumMergedGrandMetric(
    crmAccounts,
    clientAccounts,
    'open_calls',
    globalMergeFlags,
    clientMergeWithCrm,
    accountRowsOverride
  );
}

export function sumMergedAccountOpenCallsByRegion(
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  region: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs
): number {
  return sumMergedAccountMetricByRegion(
    accounts,
    clientAccounts,
    region,
    'open_calls',
    globalMergeFlags,
    clientMergeWithCrm
  );
}

export function resolveSummaryRegionMetric(
  alignCrmToAccounts: boolean,
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  region: string,
  field: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  crmFallback: number,
  clientFallback: number
): { mergeSelection: MergeSelection; crm: number; client: number } {
  if (alignCrmToAccounts) {
    return {
      mergeSelection: { crm: true, client: false },
      crm: sumMergedAccountMetricByRegion(
        accounts,
        clientAccounts,
        region,
        field,
        globalMergeFlags,
        clientMergeWithCrm
      ),
      client: 0,
    };
  }
  return { mergeSelection: globalMergeFlags, crm: crmFallback, client: clientFallback };
}

export function resolveSummaryRegionOpenCalls(
  alignCrmToAccounts: boolean,
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  region: string,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  crmFallback: number,
  clientFallback: number
): { mergeSelection: MergeSelection; crm: number; client: number } {
  if (alignCrmToAccounts) {
    return {
      mergeSelection: { crm: true, client: false },
      crm: sumMergedAccountOpenCallsByRegion(
        accounts,
        clientAccounts,
        region,
        globalMergeFlags,
        clientMergeWithCrm
      ),
      client: 0,
    };
  }
  return { mergeSelection: globalMergeFlags, crm: crmFallback, client: clientFallback };
}

export function sumMergedAccountOpenCalls(
  accounts: Array<Record<string, unknown>>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs,
  byAccountOnly = false
): number {
  return sumMergedAccountMetric(
    accounts,
    clientAccounts,
    'open_calls',
    globalMergeFlags,
    clientMergeWithCrm,
    byAccountOnly
  );
}

export function displayLoggedCallCount(
  totalCalls: number,
  cancelledCalls: number,
  totalIncludesCancelled = true
): number {
  return totalIncludesCancelled ? totalCalls : totalCalls + cancelledCalls;
}

export function findBranchMetric(
  branches: Array<Record<string, unknown>> | undefined,
  region: string,
  field: string
): number {
  if (!branches?.length) return 0;
  return branches
    .filter((b) => regionsMatch(region, String(b.region ?? '')))
    .reduce((sum, b) => sum + Number(b[field] ?? 0), 0);
}

export function findBranchRowMetric(
  branches: Array<Record<string, unknown>> | undefined,
  region: string,
  branch: string,
  field: string
): number {
  if (!branches?.length) return 0;
  const branchLower = branch.trim().toLowerCase();
  const matched = branches.filter((b) => {
    if (!regionsMatch(region, String(b.region ?? ''))) return false;
    // Exact label only — substring match glued Cadbury plant "Ranchi" onto
    // "1150 - RANCHI BRANCH" and double-counted Branch-wise Performance.
    const label = String(b.branch ?? '').trim().toLowerCase();
    return label === branchLower;
  });
  return matched.reduce((sum, b) => sum + Number(b[field] ?? 0), 0);
}

export function sumBranchMetric(
  branches: Array<Record<string, unknown>> | undefined,
  field: string
): number {
  if (!branches?.length) return 0;
  return branches.reduce((sum, b) => sum + Number(b[field] ?? 0), 0);
}

export function sumBranchLoggedCalls(
  branches: Array<Record<string, unknown>> | undefined
): number {
  if (!branches?.length) return 0;
  return branches.reduce((sum, b) => sum + Number(b.total_calls ?? 0), 0);
}

export function sumAccountMetric(
  accounts: Array<Record<string, unknown>> | undefined,
  field: string
): number {
  if (!accounts?.length) return 0;
  const clientField = resolveClientAccountField(field);
  return accounts.reduce((sum, a) => sum + Number(a[clientField] ?? 0), 0);
}

export function accountOpenCallsFromAging(
  accounts: Array<Record<string, unknown>> | undefined,
  region: string,
  account: string
): number {
  return findAccountMetric(accounts, region, account, 'open_calls');
}

export function sumAccountMetricByRegion(
  accounts: Array<Record<string, unknown>> | undefined,
  region: string,
  field: string
): number {
  if (!accounts?.length) return 0;
  const clientField = resolveClientAccountField(field);
  return accounts
    .filter((a) => regionsMatch(region, String(a.region ?? '')))
    .reduce((sum, a) => sum + Number(a[clientField] ?? 0), 0);
}

export function rollupCrmAccountsByRegion(
  accounts: Array<Record<string, unknown>> | undefined,
  region: string
): {
  population: number;
  total_calls: number;
  total_solved: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
} {
  const empty = {
    population: 0,
    total_calls: 0,
    total_solved: 0,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    active_eng: 0,
  };
  if (!accounts?.length) return empty;
  const matched = accounts.filter((a) => regionsMatch(region, String(a.region ?? '')));
  return matched.reduce<typeof empty>(
    (acc, a) => ({
      population: acc.population + Number(a.population ?? 0),
      total_calls: acc.total_calls + Number(a.total_calls ?? 0),
      total_solved: acc.total_solved + Number(a.total_solved ?? 0),
      cancelled_calls: acc.cancelled_calls + Number(a.cancelled_calls ?? 0),
      open_calls: acc.open_calls + Number(a.open_calls ?? 0),
      age_2: acc.age_2 + Number(a.age_2 ?? 0),
      age_3: acc.age_3 + Number(a.age_3 ?? 0),
      age_7: acc.age_7 + Number(a.age_7 ?? 0),
      age_15: acc.age_15 + Number(a.age_15 ?? 0),
      part_pending: acc.part_pending + Number(a.part_pending ?? 0),
      active_eng: acc.active_eng + Number(a.active_eng ?? 0),
    }),
    empty
  );
}

const ACCOUNT_SUM_FIELDS = [
  'population',
  'total_calls',
  'total_solved',
  'cancelled_calls',
  'open_calls',
  'age_2',
  'age_3',
  'age_7',
  'age_15',
  'part_pending',
  'deployment_total',
  'deployment_done',
  'installation_total',
  'installation_done',
  'active_eng',
  'total_tech_solved',
] as const;

/** One row per account — sums metrics across all zone rows. */
export function rollupAccountsByAccount(
  accounts: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const byAccount = new Map<string, Record<string, unknown>>();

  for (const row of accounts) {
    const account = String(row.account ?? '').trim();
    if (!account) continue;
    const key = account.toLowerCase();
    if (!byAccount.has(key)) {
      const base: Record<string, unknown> = {
        region: 'All India',
        account,
        headcount: 0,
      };
      for (const field of ACCOUNT_SUM_FIELDS) base[field] = 0;
      byAccount.set(key, base);
    }
    const agg = byAccount.get(key)!;
    for (const field of ACCOUNT_SUM_FIELDS) {
      agg[field] = Number(agg[field] ?? 0) + Number(row[field] ?? 0);
    }
    agg.headcount = Math.max(Number(agg.headcount ?? 0), Number(row.headcount ?? 0));
  }

  return [...byAccount.values()].sort((a, b) =>
    String(a.account ?? '').localeCompare(String(b.account ?? ''))
  );
}

export function accountOpenCallsFromAgingByAccount(
  accounts: Array<Record<string, unknown>> | undefined,
  account: string
): number {
  return findAccountMetricByAccount(accounts, account, 'open_calls');
}

export function matchesRegionFilter(filterRegion: string[], region: string): boolean {
  if (filterRegion.length === 0) return true;
  return filterRegion.some((r) => regionsMatch(r, region));
}

export function matchesAccountFilter(filterAccount: string[], account: string): boolean {
  if (filterAccount.length === 0) return true;
  return filterAccount.some((name) => accountsMatch(name, account));
}

export function filterClientAccountSummary(
  accounts: Array<Record<string, unknown>> | undefined,
  filterRegion: string[],
  filterAccount: string[]
): Array<Record<string, unknown>> {
  if (!accounts?.length) return [];
  return accounts.filter((a) => {
    const region = String(a.region ?? '');
    const account = String(a.account ?? '');
    return matchesRegionFilter(filterRegion, region) && matchesAccountFilter(filterAccount, account);
  });
}

export type ClientRegionalRow = {
  region: string;
  total_calls: number;
  total_solved: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
};

export function buildClientOnlyRegionalRows(
  clientAccounts: Array<Record<string, unknown>> | undefined
): ClientRegionalRow[] {
  if (!clientAccounts?.length) return [];
  const byRegion = new Map<string, ClientRegionalRow>();
  for (const a of clientAccounts) {
    const region = formatDisplayRegion(String(a.region ?? ''));
    const row =
      byRegion.get(region) ??
      ({
        region,
        total_calls: 0,
        total_solved: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        active_eng: 0,
      } satisfies ClientRegionalRow);
    row.total_calls += Number(a.total_calls ?? 0);
    row.total_solved += Number(a.total_solved ?? 0);
    row.cancelled_calls += Number(a.cancelled_calls ?? 0);
    row.open_calls += Number(a.open_calls ?? 0);
    row.age_2 += Number(a.age_2 ?? 0);
    row.age_3 += Number(a.age_3 ?? 0);
    row.age_7 += Number(a.age_7 ?? 0);
    row.age_15 += Number(a.age_15 ?? 0);
    row.part_pending += Number(a.part_pending ?? 0);
    row.active_eng += Number(a.active_eng ?? 0);
    byRegion.set(region, row);
  }
  return [...byRegion.values()].sort((a, b) => a.region.localeCompare(b.region));
}

/** Unique sorted account names from display rows. */
export function listAvailableKeyAccounts(
  rows: Array<Record<string, unknown>>
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    const account = String(row.account ?? '').trim();
    if (!account) continue;
    const key = account.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(account);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** Filter rows to selected account names (case-insensitive). */
export function filterKeyAccountRows(
  rows: Array<Record<string, unknown>>,
  selectedAccounts: string[]
): Array<Record<string, unknown>> {
  if (!selectedAccounts.length) return [];
  const filtered = rows.filter((row) =>
    selectedAccounts.some((name) => accountsMatchDisplayOrKey(name, String(row.account ?? '')))
  );
  return sortAccountRowsByZoneThenAccount(filtered);
}

const ZONE_DISPLAY_ORDER: Record<string, number> = {
  NORTH: 0,
  'NORTH ZONE': 0,
  EAST: 1,
  'EAST ZONE': 1,
  WEST: 2,
  'WEST ZONE': 2,
  SOUTH: 3,
  'SOUTH ZONE': 3,
};

function zoneDisplayOrder(region: string): number {
  const key = formatDisplayRegion(region).toUpperCase();
  return ZONE_DISPLAY_ORDER[key] ?? ZONE_DISPLAY_ORDER[zoneKey(region)] ?? 99;
}

/** Key account MIS / email body: NORTH → EAST → WEST → SOUTH, then account name. */
export function sortAccountRowsByZoneThenAccount(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => {
    const byRegion = zoneDisplayOrder(String(a.region ?? '')) - zoneDisplayOrder(String(b.region ?? ''));
    if (byRegion !== 0) return byRegion;
    return String(a.account ?? '').localeCompare(String(b.account ?? ''), undefined, {
      sensitivity: 'base',
    });
  });
}

export type MergedAccountMetricRow = {
  region: string;
  account: string;
  total_calls: number;
  total_solved: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  active_eng: number;
  pct_gt_7: string;
};

/** Build merged metric values for one account row (Key Account MIS rules). */
export function buildMergedAccountMetricRow(
  row: Record<string, unknown>,
  clientAccounts: Array<Record<string, unknown>> | undefined,
  globalMergeFlags: MergeSelection,
  clientMergeWithCrm: ClientMergeWithCrmPrefs
): MergedAccountMetricRow {
  const region = String(row.region ?? '');
  const account = String(row.account ?? '');
  const flags = accountMergeFlags(account, globalMergeFlags, clientMergeWithCrm);
  const clientMetric = (field: string) => findAccountMetric(clientAccounts, region, account, field);

  const openDisplay = mergeSelectedMetrics(
    Number(row.open_calls ?? 0),
    clientMetric('open_calls'),
    flags
  );
  const mergedAge7 = mergeSelectedMetrics(Number(row.age_7 ?? 0), clientMetric('age_7'), flags);
  const mergedAge15 = mergeSelectedMetrics(Number(row.age_15 ?? 0), clientMetric('age_15'), flags);
  const pct_gt_7 =
    openDisplay > 0
      ? `${Math.round(((mergedAge7 + mergedAge15) / openDisplay) * 100)}%`
      : '0%';

  return {
    region,
    account,
    total_calls: mergeSelectedMetrics(Number(row.total_calls ?? 0), clientMetric('total_calls'), flags),
    total_solved: mergeSelectedMetrics(
      Number(row.total_solved ?? 0),
      clientMetric('total_solved'),
      flags
    ),
    cancelled_calls: mergeSelectedMetrics(
      Number(row.cancelled_calls ?? 0),
      clientMetric('cancelled_calls'),
      flags
    ),
    open_calls: openDisplay,
    age_2: mergeSelectedMetrics(Number(row.age_2 ?? 0), clientMetric('age_2'), flags),
    age_3: mergeSelectedMetrics(Number(row.age_3 ?? 0), clientMetric('age_3'), flags),
    age_7: mergedAge7,
    age_15: mergedAge15,
    active_eng: mergeSelectedMetrics(Number(row.active_eng ?? 0), clientMetric('active_eng'), flags),
    pct_gt_7,
  };
}
