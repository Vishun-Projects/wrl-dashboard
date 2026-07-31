'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown } from 'lucide-react';
import { ReportErrorBoundary } from '@/features/report/components/ReportErrorBoundary';
import {
  SummaryMergedMetricCell,
  accountMergeFlags,
  accountOpenCallsFromAging,
  accountOpenCallsFromAgingByAccount,
  filterClientAccountSummary,
  findAccountMetric,
  findAccountMetricByAccount,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeSelectedMetrics,
  sumBranchLoggedCalls,
  sumMergedAccountMetric,
  sumMergedAccountOpenCalls,
  type ClientMergeWithCrmPrefs,
  type MergeSelection,
} from '@/features/report/components/SummaryMergedMetricCell';
import {
  regionPerfAccountCellClass,
  resolveAccountMisTableRows,
  type AccountMisGrouping,
} from '@/features/report/services/report-page-helpers';
import type { BranchSummaryRow } from '@/lib/summary/derive';
import { SortableTh } from '@/components/ui/SortableTh';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type Props = {
  accountMisGrouping: AccountMisGrouping;
  accountMisTopN: number;
  accountMisZoneTopExclude: string[];
  clientAccountSummaryData: Array<Record<string, unknown>>;
  clientMergeWithCrm: ClientMergeWithCrmPrefs;
  filterAccount: string[];
  filterRegion: string[];
  globalHeadcount: number;
  handleDrillDown: (type: string, title: string, params: Record<string, unknown>) => void | Promise<void>;
  mergeFlags: MergeSelection;
  mergedAccountRowsForTotals: Array<Record<string, unknown>>;
  setAccountMisGrouping: Dispatch<SetStateAction<AccountMisGrouping>>;
  setAccountMisTopN: Dispatch<SetStateAction<number>>;
  setAccountMisZoneTopExclude: Dispatch<SetStateAction<string[]>>;
  setFilterAccount: Dispatch<SetStateAction<string[]>>;
  setFilterRegion: Dispatch<SetStateAction<string[]>>;
  setShowAccountDropdown: Dispatch<SetStateAction<boolean>>;
  setShowRegionDropdown: Dispatch<SetStateAction<boolean>>;
  setShowZoneTopExcludeDropdown: Dispatch<SetStateAction<boolean>>;
  setTempFilterAccount: Dispatch<SetStateAction<string[]>>;
  setTempFilterRegion: Dispatch<SetStateAction<string[]>>;
  setTempZoneTopExclude: Dispatch<SetStateAction<string[]>>;
  showAccountDropdown: boolean;
  showRegionDropdown: boolean;
  showZoneTopExcludeDropdown: boolean;
  summaryData: BranchSummaryRow[];
  summaryTabLoading: boolean;
  tempFilterAccount: string[];
  tempFilterRegion: string[];
  tempZoneTopExclude: string[];
};

export function ReportAccountsTabPanel({
  accountMisGrouping,
  accountMisTopN,
  accountMisZoneTopExclude,
  clientAccountSummaryData,
  clientMergeWithCrm,
  filterAccount,
  filterRegion,
  globalHeadcount,
  handleDrillDown,
  mergeFlags,
  mergedAccountRowsForTotals,
  setAccountMisGrouping,
  setAccountMisTopN,
  setAccountMisZoneTopExclude,
  setFilterAccount,
  setFilterRegion,
  setShowAccountDropdown,
  setShowRegionDropdown,
  setShowZoneTopExcludeDropdown,
  setTempFilterAccount,
  setTempFilterRegion,
  setTempZoneTopExclude,
  showAccountDropdown,
  showRegionDropdown,
  showZoneTopExcludeDropdown,
  summaryData,
  summaryTabLoading,
  tempFilterAccount,
  tempFilterRegion,
  tempZoneTopExclude,
}: Props) {
  type AccountSortKey =
    | 'region'
    | 'account'
    | 'population'
    | 'total_calls'
    | 'total_solved'
    | 'cancelled_calls'
    | 'open_calls'
    | 'age_2'
    | 'age_3'
    | 'age_7'
    | 'age_15'
    | 'perc_gt_7'
    | 'part_pending'
    | 'active_eng'
    | 'deployment_total'
    | 'deployment_done'
    | 'deployment_pending'
    | 'installation_done'
    | 'installation_pending';
  const [accountSort, setAccountSort] = useState<TableSortState<AccountSortKey> | null>(null);
  const { displayAccounts, filteredAccounts, filteredClientAccounts, tableAccounts } = useMemo(() => {
    const displayAccounts = mergedAccountRowsForTotals;
    const filteredAccounts = displayAccounts.filter((a) => {
      return (
        matchesRegionFilter(filterRegion, String(a.region ?? '')) &&
        matchesAccountFilter(filterAccount, String(a.account ?? ''))
      );
    });
    return {
      displayAccounts,
      filteredAccounts,
      filteredClientAccounts: filterClientAccountSummary(clientAccountSummaryData, filterRegion, filterAccount),
      tableAccounts: resolveAccountMisTableRows(
        filteredAccounts,
        accountMisGrouping,
        accountMisTopN,
        clientAccountSummaryData,
        mergeFlags,
        clientMergeWithCrm,
        accountMisZoneTopExclude
      ),
    };
  }, [accountMisGrouping, accountMisTopN, accountMisZoneTopExclude, clientAccountSummaryData, clientMergeWithCrm, filterAccount, filterRegion, mergeFlags, mergedAccountRowsForTotals]);
  const sortedTableAccounts = useMemo(() => {
    if (!accountSort) return tableAccounts;
    return sortRows(
      tableAccounts,
      (account) => {
        if (accountSort.key === 'region' || accountSort.key === 'account') {
          return String(account[accountSort.key] ?? '');
        }
        if (accountSort.key === 'perc_gt_7') {
          const open = Number(account.open_calls || 0);
          return open ? ((Number(account.age_7 || 0) + Number(account.age_15 || 0)) / open) * 100 : 0;
        }
        if (accountSort.key === 'deployment_pending') {
          return Number(account.deployment_total || 0) - Number(account.deployment_done || 0);
        }
        if (accountSort.key === 'installation_pending') {
          return Number(account.installation_total || 0) - Number(account.installation_done || 0);
        }
        return Number(account[accountSort.key] ?? 0);
      },
      accountSort.dir
    );
  }, [accountSort, tableAccounts]);

  return (
    <>
          <ReportErrorBoundary label="Key Account MIS">
            <div className="relative flex-1 flex flex-col min-h-0 p-6 space-y-4 bg-bg-soft/10">
              {summaryTabLoading ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
                  aria-hidden
                />
              ) : null}
              <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-2 mb-2 flex-shrink-0">
                      <h2 className="text-[11px] text-slate-500 ui-label">Key Account Wise Performance</h2>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {accountMisGrouping === 'zone-top' ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] text-slate-600">
                              <span className="ui-label">Top</span>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={accountMisTopN}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10);
                                  if (!Number.isFinite(n)) return;
                                  const clamped = Math.max(1, Math.min(100, n));
                                  setAccountMisTopN(clamped);
                                  localStorage.setItem('report_account_mis_top_n', String(clamped));
                                }}
                                className="w-10 rounded border border-slate-200 px-1 py-0.5 text-center text-[10px] ui-strong"
                              />
                              <span className="ui-label">per zone</span>
                            </label>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!showZoneTopExcludeDropdown) {
                                    setTempZoneTopExclude(accountMisZoneTopExclude);
                                  }
                                  setShowZoneTopExcludeDropdown(!showZoneTopExcludeDropdown);
                                }}
                                className="flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] text-slate-600 hover:border-slate-400 ui-label"
                              >
                                <span>
                                  Exclude
                                  {accountMisZoneTopExclude.length > 0
                                    ? ` (${accountMisZoneTopExclude.length})`
                                    : ''}
                                </span>
                                <ChevronDown size={10} />
                              </button>
                              {showZoneTopExcludeDropdown ? (
                                <>
                                  <div
                                    className="fixed inset-0 z-[60]"
                                    onClick={() => setShowZoneTopExcludeDropdown(false)}
                                  />
                                  <div className="absolute right-0 top-full mt-1 w-52 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden">
                                    <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                      <button
                                        type="button"
                                        onClick={() => setTempZoneTopExclude([])}
                                        className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong"
                                      >
                                        Clear
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAccountMisZoneTopExclude(tempZoneTopExclude);
                                          localStorage.setItem(
                                            'report_account_mis_zone_top_exclude',
                                            JSON.stringify(tempZoneTopExclude)
                                          );
                                          setShowZoneTopExcludeDropdown(false);
                                        }}
                                        className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong"
                                      >
                                        Done
                                      </button>
                                    </div>
                                    <p className="px-2 py-1 text-[9px] text-slate-500 border-b border-slate-100">
                                      Checked accounts are hidden from zone top ranking.
                                    </p>
                                    <div className="max-h-48 overflow-y-auto p-1">
                                      {Array.from(
                                        new Set(displayAccounts.map((a) => String(a.account ?? '')))
                                      )
                                        .sort()
                                        .map((acc) => (
                                          <label
                                            key={acc}
                                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempZoneTopExclude.some(
                                                (x) =>
                                                  x.trim().toLowerCase() === acc.trim().toLowerCase()
                                              )}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempZoneTopExclude([...tempZoneTopExclude, acc]);
                                                } else {
                                                  setTempZoneTopExclude(
                                                    tempZoneTopExclude.filter(
                                                      (x) =>
                                                        x.trim().toLowerCase() !==
                                                        acc.trim().toLowerCase()
                                                    )
                                                  );
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 ui-label">
                                              {acc}
                                            </span>
                                          </label>
                                        ))}
                                    </div>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                        <div
                          className="flex items-center gap-1.5"
                          role="group"
                          aria-labelledby="account-mis-layout-label"
                        >
                          <span
                            id="account-mis-layout-label"
                            className="text-[10px] font-normal text-slate-400 ui-label select-none cursor-default"
                          >
                            Layout:
                          </span>
                          <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-bg-soft/80 p-0.5 text-[10px]">
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'zone'}
                            onClick={() => {
                              setAccountMisGrouping('zone');
                              localStorage.setItem('report_account_mis_grouping', 'zone');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'zone'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Total Calls
                          </button>
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'zone-top'}
                            onClick={() => {
                              setAccountMisGrouping('zone-top');
                              localStorage.setItem('report_account_mis_grouping', 'zone-top');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'zone-top'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Top Client
                          </button>
                          <button
                            type="button"
                            aria-pressed={accountMisGrouping === 'overview'}
                            onClick={() => {
                              setAccountMisGrouping('overview');
                              localStorage.setItem('report_account_mis_grouping', 'overview');
                            }}
                            className={`rounded px-2 py-0.5 ui-label transition-colors ${
                              accountMisGrouping === 'overview'
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-600 hover:bg-bg-canvas'
                            }`}
                          >
                            Client Wise
                          </button>
                          </div>
                        </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 bg-bg-canvas border border-slate-200 rounded-lg shadow-sm overflow-auto custom-scrollbar relative">
                      <table className="perf-account-mis-table w-full text-left border-collapse text-[10px]">
                        <thead className="sticky top-0 z-20 outline outline-1 outline-slate-800 shadow-sm">
                          {/* Category Headers */}
                          <tr className="account-mis-cat-header bg-slate-800 text-white ui-strong">
                            <th className="ui-field-label p-1.5 border-r border-slate-600/50 text-white" colSpan={accountMisGrouping === 'overview' ? 2 : 3}>Basics</th>
                            <th className="ui-field-label p-1.5 border-r border-slate-600/50 text-center text-white" colSpan={4}>Calls Summary (Breakdown)</th>
                            <th className="ui-field-label p-1.5 border-r border-slate-600/50 text-center text-white account-mis-cat-header--aging" colSpan={7}>Breakdown (Aging)</th>
                            <th className="ui-field-label p-1.5 border-r border-slate-600/50 text-center text-white account-mis-cat-header--deploy" colSpan={3}>Deployment</th>
                            <th className="ui-field-label p-1.5 text-center text-white account-mis-cat-header--install" colSpan={2}>Installation</th>
                          </tr>
                          <tr className="account-mis-col-header bg-slate-100 text-slate-700 ui-strong">
                            {accountMisGrouping !== 'overview' ? (
                            <SortableTh
                              className="p-1.5 border border-slate-300"
                              active={accountSort?.key === 'region'}
                              dir={accountSort?.dir}
                              onClick={() => setAccountSort((prev) => toggleSort(prev, 'region'))}
                            >
                              <div className="flex flex-col gap-1 relative">
                                <span>Region</span>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!showRegionDropdown) {
                                      setTempFilterRegion(filterRegion);
                                    }
                                    setShowRegionDropdown(!showRegionDropdown);
                                  }}
                                  className="w-full bg-bg-canvas border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong"
                                >
                                  <span className="truncate">
                                    {filterRegion.length === 0 ? 'All' : `${filterRegion.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showRegionDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowRegionDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                      <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterRegion([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterRegion(tempFilterRegion);
                                            setShowRegionDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(displayAccounts.map(a => String(a.region ?? '')))).sort().map(r => (
                                          <label key={r} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterRegion.includes(r)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterRegion([...tempFilterRegion, r]);
                                                } else {
                                                  setTempFilterRegion(tempFilterRegion.filter(x => x !== r));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{r}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </SortableTh>
                            ) : null}
                            <SortableTh
                              className="p-1.5 border border-slate-300"
                              active={accountSort?.key === 'account'}
                              dir={accountSort?.dir}
                              onClick={() => setAccountSort((prev) => toggleSort(prev, 'account'))}
                            >
                              <div className="flex flex-col gap-1 relative">
                                <span>Key Account</span>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!showAccountDropdown) {
                                      setTempFilterAccount(filterAccount);
                                    }
                                    setShowAccountDropdown(!showAccountDropdown);
                                  }}
                                  className="w-full bg-bg-canvas border border-slate-200 rounded px-1.5 py-1 text-[9px] text-slate-700 flex items-center justify-between hover:border-slate-400 transition-all ui-strong font-medium"
                                >
                                  <span className="truncate">
                                    {filterAccount.length === 0 ? 'All' : `${filterAccount.length} Selected`}
                                  </span>
                                  <ChevronDown size={10} />
                                </button>

                                {showAccountDropdown && (
                                  <>
                                    <div className="fixed inset-0 z-[60]" onClick={() => setShowAccountDropdown(false)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-bg-canvas border border-slate-200 shadow-xl rounded-md z-[70] overflow-hidden animate-in fade-in zoom-in-95 duration-100 font-medium">
                                      <div className="p-1 border-b border-slate-100 bg-bg-soft flex items-center justify-between">
                                        <button
                                          onClick={() => setTempFilterAccount([])}
                                          className="text-[9px] text-slate-400 hover:text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          onClick={() => {
                                            setFilterAccount(tempFilterAccount);
                                            setShowAccountDropdown(false);
                                          }}
                                          className="text-[9px] text-slate-900 px-1.5 py-0.5 ui-strong font-semibold"
                                        >
                                          Done
                                        </button>
                                      </div>
                                      <div className="max-h-48 overflow-y-auto p-1">
                                        {Array.from(new Set(displayAccounts.map(a => String(a.account ?? '')))).sort().map(acc => (
                                          <label key={acc} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-soft rounded cursor-pointer transition-colors group">
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                              checked={tempFilterAccount.includes(acc)}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setTempFilterAccount([...tempFilterAccount, acc]);
                                                } else {
                                                  setTempFilterAccount(tempFilterAccount.filter(x => x !== acc));
                                                }
                                              }}
                                            />
                                            <span className="text-[10px] text-slate-600 group-hover:text-slate-900 ui-label">{acc}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </SortableTh>
                            {([
                              ['population', 'Population', 'p-1.5 border border-slate-300 text-center align-bottom pb-3'],
                              ['total_calls', 'Total calls', 'p-1.5 border border-slate-300 text-center align-bottom pb-3'],
                              ['total_solved', 'Total solved', 'p-1.5 border border-slate-300 text-center align-bottom pb-3'],
                              ['cancelled_calls', 'Cancelled', 'p-1.5 border border-slate-300 text-center align-bottom pb-3 text-rose-700 font-semibold'],
                              ['open_calls', '# open calls', 'p-1.5 border border-slate-300 text-center align-bottom pb-3'],
                              ['age_2', '<2 Days', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['age_3', '2-7 Days', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['age_7', '7-15 Days', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['age_15', '>15 Days', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['perc_gt_7', '% >7 Days', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['part_pending', 'Part pending', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['active_eng', '# of active Eng.', 'p-1.5 border border-slate-300 text-center text-blue-700 align-bottom pb-3 ui-strong'],
                              ['deployment_total', 'Total', 'p-1.5 border border-slate-300 text-center text-amber-700 ui-strong'],
                              ['deployment_done', 'Done', 'p-1.5 border border-slate-300 text-center text-amber-700 ui-strong'],
                              ['deployment_pending', 'Pending', 'p-1.5 border border-slate-300 text-center text-amber-700 ui-strong'],
                              ['installation_done', 'Done', 'p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong'],
                              ['installation_pending', 'Pending', 'p-1.5 border border-slate-300 text-center text-emerald-700 ui-strong'],
                            ] as const).map(([key, label, className]) => (
                              <SortableTh key={key} className={className} align="center" active={accountSort?.key === key} dir={accountSort?.dir} onClick={() => setAccountSort((prev) => toggleSort(prev, key, 'desc'))}>{label}</SortableTh>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sortedTableAccounts.map((a, i) => {
                            const region = String(a.region ?? '');
                            const account = String(a.account ?? '');
                            const isOverview = accountMisGrouping === 'overview';
                            const rowMergeFlags = accountMergeFlags(account, mergeFlags, clientMergeWithCrm);
                            const drillRegion = isOverview ? 'AI' : region;
                            const clientMetric = (field: string) =>
                              isOverview
                                ? findAccountMetricByAccount(filteredClientAccounts, account, field)
                                : findAccountMetric(clientAccountSummaryData, region, account, field);
                            const crmOpenSum = Number(a.open_calls || 0);
                            const clientOpen = isOverview
                              ? accountOpenCallsFromAgingByAccount(filteredClientAccounts, account)
                              : accountOpenCallsFromAging(
                                  clientAccountSummaryData,
                                  region,
                                  account
                                );
                            const openDisplay = mergeSelectedMetrics(crmOpenSum, clientOpen, rowMergeFlags);
                            const mergedAge7 = mergeSelectedMetrics(
                              Number(a.age_7 || 0),
                              clientMetric('age_7'),
                              rowMergeFlags
                            );
                            const mergedAge15 = mergeSelectedMetrics(
                              Number(a.age_15 || 0),
                              clientMetric('age_15'),
                              rowMergeFlags
                            );
                            const perc_gt_7 =
                              openDisplay > 0
                                ? (((mergedAge7 + mergedAge15) / openDisplay) * 100).toFixed(0) + '%'
                                : '0%';
                            const dep_pending = Number(a.deployment_total || 0) - Number(a.deployment_done || 0);
                            const inst_pending = Number(a.installation_total || 0) - Number(a.installation_done || 0);

                            const regColor = isOverview
                              ? 'perf-region-cell perf-region-cell--default'
                              : regionPerfAccountCellClass(region);

                            return (
                              <tr key={i} className="hover:bg-bg-soft transition-colors text-slate-900 border-b border-slate-200">
                                {!isOverview ? (
                                  <td className={`p-1.5 border border-slate-300 ${regColor} ui-strong`}>{region}</td>
                                ) : null}
                                <td className="p-1.5 border border-slate-300 font-medium text-[9px] bg-bg-soft/30">{account}</td>
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.population || 0)}
                                  client={clientMetric('population')}
                                  className="p-1.5 text-slate-500 ui-strong"
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.total_calls || 0)}
                                  client={clientMetric('total_calls')}
                                  className="p-1.5"
                                  onClick={() => handleDrillDown('total_calls', `${account} - Total Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.total_solved || 0)}
                                  client={clientMetric('total_solved')}
                                  className="p-1.5 text-emerald-600"
                                  onClick={() => handleDrillDown('total_solved', `${account} - Solved Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.cancelled_calls || 0)}
                                  client={clientMetric('cancelled_calls')}
                                  className="p-1.5 text-rose-600"
                                  onClick={() => handleDrillDown('cancelled_calls', `${account} - Cancelled Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td
                                  className="p-1.5 border border-slate-300 text-center text-slate-900 perf-metric-open cursor-pointer hover:bg-black/5 ui-strong"
                                  onClick={() => handleDrillDown('open_calls', `${account} - Open Calls`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                >
                                  {openDisplay.toLocaleString()}
                                </td>

                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_2 || 0)}
                                  client={clientMetric('age_2')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_2', `${account} - <2 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_3 || 0)}
                                  client={clientMetric('age_3')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_3', `${account} - 2-7 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_7 || 0)}
                                  client={clientMetric('age_7')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_7', `${account} - 7-15 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.age_15 || 0)}
                                  client={clientMetric('age_15')}
                                  className="p-1.5 perf-metric-aging"
                                  onClick={() => handleDrillDown('age_15', `${account} - >15 Days`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td className="p-1.5 border border-slate-300 text-center text-blue-700 perf-metric-pct ui-strong">{perc_gt_7}</td>

                                <SummaryMergedMetricCell
                                  mergeSelection={rowMergeFlags}
                                  crm={Number(a.part_pending || 0)}
                                  client={clientMetric('part_pending')}
                                  className="p-1.5"
                                  onClick={() => handleDrillDown('part_pending', `${account} - Part Pending`, { account, region: drillRegion, callType: 'BREAKDOWN' })}
                                />
                                <td className="p-1.5 border border-slate-300 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="text-blue-700 ui-strong">
                                      {mergeSelectedMetrics(
                                        Number(a.active_eng || 0),
                                        clientMetric('active_eng'),
                                        rowMergeFlags
                                      )}
                                    </span>
                                    <span className="text-[9px] text-slate-400 font-medium">({Number(a.headcount || 0)})</span>
                                  </div>
                                </td>

                                <td className="p-1.5 border border-slate-300 text-center perf-metric-deploy">{Number(a.deployment_total || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center perf-metric-deploy">{Number(a.deployment_done || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-amber-700 perf-metric-pending-deploy ui-strong">{dep_pending}</td>

                                <td className="p-1.5 border border-slate-300 text-center perf-metric-install">{Number(a.installation_done || 0)}</td>
                                <td className="p-1.5 border border-slate-300 text-center text-emerald-700 perf-metric-pending-install ui-strong">{inst_pending}</td>
                              </tr>
                            );
                          })}

                          {/* Account Total Row */}
                          {(() => {
                            const kamisFiltersActive =
                              filterRegion.length > 0 || filterAccount.length > 0;
                            const useBranchGrandTotals =
                              mergeFlags.crm && !mergeFlags.client && !kamisFiltersActive;

                            const kamisGrandAccountRows = kamisFiltersActive
                              ? filteredAccounts
                              : mergedAccountRowsForTotals;

                            const totalPopulation = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.population || b.total_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'population',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalCalls = useBranchGrandTotals
                              ? sumBranchLoggedCalls(summaryData)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'total_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalSolved = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'total_solved',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalCancelled = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'cancelled_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalOpen = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)
                              : sumMergedAccountOpenCalls(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge2 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_2',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge3 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_3',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge7 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_7',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalAge15 = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'age_15',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalParts = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'part_pending',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalEngs = useBranchGrandTotals
                              ? summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)
                              : sumMergedAccountMetric(
                                  kamisGrandAccountRows,
                                  clientAccountSummaryData,
                                  'active_eng',
                                  mergeFlags,
                                  clientMergeWithCrm
                                );
                            const totalPercGt7 =
                              totalOpen > 0
                                ? (((totalAge7 + totalAge15) / totalOpen) * 100).toFixed(0) + '%'
                                : '0%';

                            return (
                          <tr className="account-mis-grand-total bg-slate-900 text-white text-[10px] ui-label">
                            <td className="p-1.5 border border-slate-700" colSpan={accountMisGrouping === 'overview' ? 1 : 2}>GRAND TOTAL (AI)</td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalPopulation.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('total_calls', `All India - Total Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalCalls.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('total_solved', `All India - Solved Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalSolved.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-rose-400 cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('cancelled_calls', `All India - Cancelled Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalCancelled.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center bg-slate-800 cursor-pointer hover:bg-bg-canvas/10" onClick={() => handleDrillDown('open_calls', `All India - Open Calls`, { account: filterAccount.length === 0 ? 'All India' : filterAccount.join(','), region: 'AI', callType: 'BREAKDOWN' })}>
                              {totalOpen.toLocaleString()}
                            </td>

                            {/* Aging Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge2.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge3.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge7.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalAge15.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {totalPercGt7}
                            </td>

                            {/* Support Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {totalParts.toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-blue-400">
                              {totalEngs}
                              <span className="text-[9px] text-slate-400 ml-1">({globalHeadcount})</span>
                            </td>

                            {/* Deployment Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_total || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.deployment_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-amber-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.deployment_total || 0) - Number(a.deployment_done || 0)), 0).toLocaleString()}
                            </td>

                            {/* Installation Totals */}
                            <td className="p-1.5 border border-slate-700 text-center">
                              {filteredAccounts.reduce((sum, a) => sum + Number(a.installation_done || 0), 0).toLocaleString()}
                            </td>
                            <td className="p-1.5 border border-slate-700 text-center text-emerald-400">
                              {filteredAccounts.reduce((sum, a) => sum + (Number(a.installation_total || 0) - Number(a.installation_done || 0)), 0).toLocaleString()}
                            </td>
                          </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
            </div>
          </ReportErrorBoundary>
    </>
  );
}
