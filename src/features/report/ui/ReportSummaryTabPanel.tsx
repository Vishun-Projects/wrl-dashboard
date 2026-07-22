'use client';

import React, { type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, ChevronRight, X, AlertCircle } from 'lucide-react';
import { ReportErrorBoundary } from '@/features/report/ui/ReportErrorBoundary';
import {
  SummaryMergedMetricCell,
  accountOpenCallsFromAging,
  accountOpenCallsFromAgingByAccount,
  buildClientOnlyRegionalRows,
  displayLoggedCallCount,
  findAccountMetric,
  findAccountMetricByAccount,
  findBranchMetric,
  findBranchRowMetric,
  matchesAccountFilter,
  matchesRegionFilter,
  mergeSelectedMetrics,
  resolveSummaryRegionMetric,
  resolveSummaryRegionOpenCalls,
  rollupCrmAccountsByRegion,
  sumAccountMetric,
  sumAccountMetricByRegion,
  sumBranchLoggedCalls,
  sumBranchMetric,
  sumMergedAccountMetric,
  sumMergedAccountOpenCalls,
  isAccountExcludedFromZoneTop,
  DEFAULT_ZONE_TOP_EXCLUDE_ACCOUNTS,
  type ClientMergeWithCrmPrefs,
  type MergeSelection,
} from '@/features/report/ui/SummaryMergedMetricCell';
import {
  regionPerfAccountCellClass,
  regionPerfRowClass,
  resolveAccountMisTableRows,
} from '@/features/report/lib/report-page-helpers';
import { BdMisSummaryPanel } from '@/features/report/ui/BdMisSummaryPanel';
import type { BdMisRegionalRow } from '@/features/report/lib/bd-mis-summary';
import type { BranchSummaryRow } from '@/lib/summary/derive';

type Props = {
  accountsData: Array<Record<string, unknown>>;
  alignCrmToAccounts: boolean;
  clientAccountSummaryData: Array<Record<string, unknown>>;
  clientMergeWithCrm: ClientMergeWithCrmPrefs;
  clientOnlyMode: boolean;
  clientSummaryData: Array<Record<string, unknown>>;
  excelUnionRegionalRows: BdMisRegionalRow[];
  expandedBranches: Record<string, boolean>;
  handleDrillDown: (type: string, title: string, params: Record<string, unknown>) => void | Promise<void>;
  mergeFlags: MergeSelection;
  mergedAccountRowsForTotals: Array<Record<string, unknown>>;
  setExpandedBranches: Dispatch<SetStateAction<Record<string, boolean>>>;
  summaryData: BranchSummaryRow[];
  summaryTabLoading: boolean;
  useBdMisExcelUnion: boolean;
};

export function ReportSummaryTabPanel({
  accountsData,
  alignCrmToAccounts,
  clientAccountSummaryData,
  clientMergeWithCrm,
  clientOnlyMode,
  clientSummaryData,
  excelUnionRegionalRows,
  expandedBranches,
  handleDrillDown,
  mergeFlags,
  mergedAccountRowsForTotals,
  setExpandedBranches,
  summaryData,
  summaryTabLoading,
  useBdMisExcelUnion,
}: Props) {
  return (
    <>
          <ReportErrorBoundary label="Summary Dashboard">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-soft/10 inner-scrollbar">
            {summaryTabLoading ? (
              <div
                className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
                aria-hidden
              />
            ) : null}
            <div className="flex flex-col gap-3 p-4 pb-8">
              {/* Region Summary Table — fixed compact block, always visible */}
              <section>
                <h2 className="mb-2 px-2 text-[11px] text-slate-500 ui-label">Regional Performance (AI)</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-bg-canvas shadow-sm">
                  <table className="perf-dashboard-table w-full text-left border-collapse text-[11px]">
                    <thead className="perf-table-header">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30">Region</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'≤2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'3-7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'8-15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {useBdMisExcelUnion
                        ? excelUnionRegionalRows.map((row) => (
                            <tr
                              key={row.region}
                              className={`${regionPerfRowClass(row.region)} text-slate-900 ui-strong`}
                            >
                              <td className="p-2 border border-slate-300">{row.region}</td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('total_calls', `${row.region} - Total Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {displayLoggedCallCount(
                                  row.total_calls,
                                  row.cancelled_calls,
                                  false
                                ).toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums text-emerald-600 cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('solved_calls', `${row.region} - Solved Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.total_solved.toLocaleString()}
                              </td>
                              <td className="p-2 border border-slate-300 text-center tabular-nums text-rose-600">
                                {row.cancelled_calls.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums perf-metric-open ui-strong cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('open_calls', `${row.region} - Open Calls`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.open_calls.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_2', `${row.region} - <2 Days`, { region: row.region })
                                }
                              >
                                {row.age_2.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_3', `${row.region} - 2-7 Days`, { region: row.region })
                                }
                              >
                                {row.age_3.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_7', `${row.region} - 7-15 Days`, { region: row.region })
                                }
                              >
                                {row.age_7.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('age_15', `${row.region} - >15 Days`, { region: row.region })
                                }
                              >
                                {row.age_15.toLocaleString()}
                              </td>
                              <td
                                className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                                onClick={() =>
                                  handleDrillDown('part_pending', `${row.region} - Part Pending`, {
                                    region: row.region,
                                  })
                                }
                              >
                                {row.part_pending.toLocaleString()}
                              </td>
                              <td className="p-2 border border-slate-300 text-center tabular-nums">
                                {row.active_eng.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        : clientOnlyMode
                        ? buildClientOnlyRegionalRows(clientAccountSummaryData).map((row) => {
                            const open = row.open_calls;
                            return (
                              <tr
                                key={row.region}
                                className={`${regionPerfRowClass(row.region)} text-slate-900 ui-strong`}
                              >
                                <td className="p-2 border border-slate-300">{row.region}</td>
                                <td className="p-2 border border-slate-300 text-center tabular-nums">
                                  {displayLoggedCallCount(
                                  row.total_calls,
                                  row.cancelled_calls,
                                  false
                                ).toLocaleString()}
                                </td>
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.total_solved} className="text-emerald-600" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.cancelled_calls} className="text-rose-600" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={open} className="perf-metric-open ui-strong" />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_2} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_3} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_7} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.age_15} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.part_pending} />
                                <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={row.active_eng} />
                              </tr>
                            );
                          })
                        : Array.from(
                            new Set(
                              (alignCrmToAccounts ? mergedAccountRowsForTotals : summaryData).map((b) =>
                                String(b.region ?? '')
                              )
                            )
                          )
                            .sort()
                            .map((region) => {
                        const totals = alignCrmToAccounts
                          ? (() => {
                              const r = rollupCrmAccountsByRegion(accountsData, region);
                              return {
                                total: r.total_calls,
                                solved: r.total_solved,
                                cancelled: r.cancelled_calls,
                                open: r.open_calls,
                                age2: r.age_2,
                                age3: r.age_3,
                                age7: r.age_7,
                                age15: r.age_15,
                                parts: r.part_pending,
                                engs: r.active_eng,
                              };
                            })()
                          : summaryData
                              .filter((b) => b.region === region)
                              .reduce(
                                (acc, b) => ({
                                  total: acc.total + Number(b.total_calls || 0),
                                  solved: acc.solved + Number(b.solved_calls || 0),
                                  cancelled: acc.cancelled + Number(b.cancelled_calls || 0),
                                  open: acc.open + Number(b.open_calls || 0),
                                  age2: acc.age2 + Number(b.age_2 || 0),
                                  age3: acc.age3 + Number(b.age_3 || 0),
                                  age7: acc.age7 + Number(b.age_7 || 0),
                                  age15: acc.age15 + Number(b.age_15 || 0),
                                  parts: acc.parts + Number(b.part_pending || 0),
                                  engs: acc.engs + Number(b.active_eng || 0),
                                }),
                                {
                                  total: 0,
                                  solved: 0,
                                  cancelled: 0,
                                  open: 0,
                                  age2: 0,
                                  age3: 0,
                                  age7: 0,
                                  age15: 0,
                                  parts: 0,
                                  engs: 0,
                                }
                              );

                        const crmTotal = totals.total;
                        const crmSolved = totals.solved;
                        const crmCancelled = totals.cancelled;
                        const crmOpen = totals.open;
                        const crmAge2 = totals.age2;
                        const crmAge3 = totals.age3;
                        const crmAge7 = totals.age7;
                        const crmAge15 = totals.age15;
                        const crmParts = totals.parts;
                        const crmEngs = totals.engs;

                        const clientField = (field: string) =>
                          mergeFlags.client
                            ? alignCrmToAccounts
                              ? sumAccountMetricByRegion(clientAccountSummaryData, region, field)
                              : findBranchMetric(clientSummaryData, region, field)
                            : 0;

                        const mTotal = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'total_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmTotal,
                          clientField('total_calls')
                        );
                        const mSolved = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          alignCrmToAccounts ? 'total_solved' : 'solved_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmSolved,
                          clientField(alignCrmToAccounts ? 'total_solved' : 'solved_calls')
                        );
                        const mCancelled = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'cancelled_calls',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmCancelled,
                          clientField('cancelled_calls')
                        );
                        const mOpen = resolveSummaryRegionOpenCalls(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          mergeFlags,
                          clientMergeWithCrm,
                          crmOpen,
                          alignCrmToAccounts
                            ? clientField('age_2') +
                                clientField('age_3') +
                                clientField('age_7') +
                                clientField('age_15')
                            : clientField('open_calls')
                        );
                        const mAge2 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_2',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge2,
                          clientField('age_2')
                        );
                        const mAge3 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_3',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge3,
                          clientField('age_3')
                        );
                        const mAge7 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_7',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge7,
                          clientField('age_7')
                        );
                        const mAge15 = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'age_15',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmAge15,
                          clientField('age_15')
                        );
                        const mParts = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'part_pending',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmParts,
                          clientField('part_pending')
                        );
                        const mEngs = resolveSummaryRegionMetric(
                          alignCrmToAccounts,
                          mergedAccountRowsForTotals,
                          clientAccountSummaryData,
                          region,
                          'active_eng',
                          mergeFlags,
                          clientMergeWithCrm,
                          crmEngs,
                          clientField('active_eng')
                        );

                        return (
                          <tr key={region} className={`${regionPerfRowClass(region)} text-slate-900 ui-strong`}>
                            <td className="p-2 border border-slate-300">{region}</td>
                            <td
                              className="p-2 border border-slate-300 text-center tabular-nums cursor-pointer hover:bg-black/5"
                              onClick={() => handleDrillDown('total_calls', `${region} - Total Calls`, { region })}
                            >
                              {displayLoggedCallCount(
                                mergeSelectedMetrics(mTotal.crm, mTotal.client, mTotal.mergeSelection),
                                mergeSelectedMetrics(
                                  mCancelled.crm,
                                  mCancelled.client,
                                  mCancelled.mergeSelection
                                ),
                                clientOnlyMode
                              ).toLocaleString()}
                            </td>
                            <SummaryMergedMetricCell {...mSolved} className="text-emerald-600" onClick={() => handleDrillDown('solved_calls', `${region} - Solved Calls`, { region })} />
                            <SummaryMergedMetricCell {...mCancelled} className="text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${region} - Cancelled Calls`, { region })} />
                            <SummaryMergedMetricCell {...mOpen} className="perf-metric-open ui-strong" onClick={() => handleDrillDown('open_calls', `${region} - Open Calls`, { region })} />
                            <SummaryMergedMetricCell {...mAge2} onClick={() => handleDrillDown('age_2', `${region} - <2 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge3} onClick={() => handleDrillDown('age_3', `${region} - 2-7 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge7} onClick={() => handleDrillDown('age_7', `${region} - 7-15 Days`, { region })} />
                            <SummaryMergedMetricCell {...mAge15} onClick={() => handleDrillDown('age_15', `${region} - >15 Days`, { region })} />
                            <SummaryMergedMetricCell {...mParts} onClick={() => handleDrillDown('part_pending', `${region} - Part Pending`, { region })} />
                            <SummaryMergedMetricCell {...mEngs} />
                          </tr>
                        );
                      })}
                      {/* All India Total Row */}
                      <tr className="perf-total-row text-slate-900 group ui-strong">
                        <td className="p-2 border border-slate-300 flex items-center justify-between">
                          <span>AI</span>
                          <button
                            onClick={() => handleDrillDown('discrepancy', 'AI - Discrepancy Records', { region: 'AI' })}
                            className="p-1 hover:bg-black/10 rounded transition-colors"
                            title="View records handled by multiple branches"
                          >
                            <AlertCircle className="w-3 h-3 text-slate-700" />
                          </button>
                        </td>
                        <td className="p-2 border border-slate-300 text-center tabular-nums">
                          {(
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'total_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : mergeFlags.client
                                ? displayLoggedCallCount(
                                    mergeSelectedMetrics(
                                      sumBranchLoggedCalls(summaryData),
                                      sumBranchMetric(clientSummaryData, 'total_calls'),
                                      mergeFlags
                                    ),
                                    mergeSelectedMetrics(
                                      summaryData.reduce(
                                        (sum, b) => sum + Number(b.cancelled_calls || 0),
                                        0
                                      ),
                                      mergeFlags.client
                                        ? sumBranchMetric(clientSummaryData, 'cancelled_calls')
                                        : 0,
                                      mergeFlags
                                    ),
                                    false
                                  )
                                : sumBranchLoggedCalls(summaryData)
                          ).toLocaleString()}
                        </td>
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'total_solved',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.solved_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'solved_calls')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'cancelled_calls',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.cancelled_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'cancelled_calls')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountOpenCalls(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.open_calls || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'open_calls')
                                : 0
                          }
                          className="bg-slate-800/20"
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_2',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_2 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_2')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_3',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_3 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_3')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_7',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_7 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_7')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'age_15',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.age_15 || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'age_15')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'part_pending',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.part_pending || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'part_pending')
                                : 0
                          }
                        />
                        <SummaryMergedMetricCell
                          mergeSelection={alignCrmToAccounts ? { crm: true, client: false } : mergeFlags}
                          crm={
                            alignCrmToAccounts
                              ? sumMergedAccountMetric(
                                  mergedAccountRowsForTotals,
                                  clientAccountSummaryData,
                                  'active_eng',
                                  mergeFlags,
                                  clientMergeWithCrm
                                )
                              : summaryData.reduce((sum, b) => sum + Number(b.active_eng || 0), 0)
                          }
                          client={
                            alignCrmToAccounts
                              ? 0
                              : mergeFlags.client
                                ? sumBranchMetric(clientSummaryData, 'active_eng')
                                : 0
                          }
                        />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Branch table — full height via page scroll */}
              <section className="flex flex-col">
                <h2 className="mb-2 flex-shrink-0 px-2 text-[11px] text-slate-500 ui-label">Branch Wise Performance</h2>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-bg-canvas shadow-sm inner-scrollbar">
                  <table className="perf-dashboard-table w-full text-left border-collapse text-[11px]">
                    <thead className="perf-table-header sticky top-0 z-20 shadow-sm">
                      <tr className="text-white text-[10px] ui-label border-b border-blue-800">
                        <th className="p-2 border-r border-slate-300/30 min-w-[200px]">Branches</th>
                        <th className="p-2 border border-slate-300 text-center">Total calls</th>
                        <th className="p-2 border border-slate-300 text-center">Total solved</th>
                        <th className="p-2 border border-slate-300 text-center">Cancelled</th>
                        <th className="p-2 border border-slate-300 text-center"># open calls</th>
                        <th className="p-2 border border-slate-300 text-center">{'≤2 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'3-7 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'8-15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">{'>15 days'}</th>
                        <th className="p-2 border border-slate-300 text-center">Part pending</th>
                        <th className="p-2 border border-slate-300 text-center"># of active Eng.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientOnlyMode ? (
                        clientSummaryData.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="p-4 text-center text-[10px] text-slate-500">
                              No client branch data for selected sources.
                            </td>
                          </tr>
                        ) : (
                          clientSummaryData.map((branch, idx) => (
                            <tr key={idx} className="hover:bg-bg-soft text-slate-900">
                              <td className="p-2 border border-slate-300">
                                {String(branch.branch ?? branch.region ?? '')}
                              </td>
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.total_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.solved_calls ?? branch.total_solved ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.cancelled_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.open_calls ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_2 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_3 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_7 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.age_15 ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.part_pending ?? 0)} />
                              <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={0} client={Number(branch.active_eng ?? 0)} />
                            </tr>
                          ))
                        )
                      ) : !mergeFlags.crm ? (
                        <tr>
                          <td colSpan={11} className="p-4 text-center text-[10px] text-slate-500">
                            CRM branch data hidden — enable CRM under Data sources.
                          </td>
                        </tr>
                      ) : (
                      Array.from(new Set(summaryData.map(b => b.region))).sort().map(region => {
                        const regionBranches = summaryData.filter(b => b.region === region);
                        if (regionBranches.length === 0) return null;

                        const topLevel = regionBranches.filter(b =>
                          b.parentId === 0 || !regionBranches.find(p => p.officeId === b.parentId)
                        ).sort((a, b) => Number(b.total_calls) - Number(a.total_calls));

                        const bgClass = regionPerfRowClass(region);

                        return (
                          <React.Fragment key={region}>
                            {topLevel.map(branch => {
                              const children = regionBranches.filter(b => b.parentId === branch.officeId);
                              const hasChildren = children.length > 0;
                              const isExpanded = expandedBranches[branch.officeId];

                              const getAggregate = (item: BranchSummaryRow, key: keyof BranchSummaryRow) => {
                                const getAllChildren = (id: number): BranchSummaryRow[] => {
                                  const direct = regionBranches.filter((b) => b.parentId === id);
                                  let all = [...direct];
                                  direct.forEach((d) => {
                                    all = [...all, ...getAllChildren(d.officeId)];
                                  });
                                  return all;
                                };
                                const allDescendants = getAllChildren(item.officeId);
                                return Number(item[key] || 0) + allDescendants.reduce((sum, d) => sum + Number(d[key] || 0), 0);
                              };

                              return (
                                <React.Fragment key={`${region}::${branch.officeId}::${branch.branch}`}>
                                  <tr className={`${bgClass} transition-colors font-medium text-slate-900`}>
                                    <td className="p-2 border border-slate-300">
                                      <div className="flex items-center gap-1">
                                        {hasChildren ? (
                                          <button
                                            onClick={() => setExpandedBranches(prev => ({ ...prev, [branch.officeId]: !prev[branch.officeId] }))}
                                            className="p-0.5 hover:bg-bg-canvas/50 rounded transition-all text-slate-700"
                                          >
                                            {isExpanded ? <ChevronDown size={12} strokeWidth={3} /> : <ChevronRight size={12} strokeWidth={3} />}
                                          </button>
                                        ) : (
                                          <div className="w-4" />
                                        )}
                                        <span className="truncate">{branch.branch}</span>
                                      </div>
                                    </td>
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'total_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'total_calls')} onClick={() => handleDrillDown('total_calls', `${branch.branch} - Total Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'solved_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'solved_calls')} onClick={() => handleDrillDown('solved_calls', `${branch.branch} - Solved Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'cancelled_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'cancelled_calls')} className="text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${branch.branch} - Cancelled Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'open_calls')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'open_calls')} className="ui-strong" onClick={() => handleDrillDown('open_calls', `${branch.branch} - Open Calls`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_2')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_2')} onClick={() => handleDrillDown('age_2', `${branch.branch} - <2 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_3')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_3')} onClick={() => handleDrillDown('age_3', `${branch.branch} - 2-7 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_7')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_7')} onClick={() => handleDrillDown('age_7', `${branch.branch} - 7-15 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'age_15')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'age_15')} onClick={() => handleDrillDown('age_15', `${branch.branch} - >15 Days`, { officeId: branch.officeId })} />
                                    <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={getAggregate(branch, 'part_pending')} client={findBranchRowMetric(clientSummaryData, region, branch.branch, 'part_pending')} onClick={() => handleDrillDown('part_pending', `${branch.branch} - Part Pending`, { officeId: branch.officeId })} />
                                    <td className="p-2 border border-slate-300 text-center">
                                      <div className="flex flex-col items-center justify-center leading-tight">
                                        <span className="text-blue-700 ui-strong">{getAggregate(branch, 'active_eng')}</span>
                                        <span className="text-[9px] text-slate-400 font-medium">of {getAggregate(branch, 'headcount')}</span>
                                      </div>
                                    </td>
                                  </tr>

                                  {isExpanded && children.map(child => (
                                    <tr key={`${region}::${branch.officeId}::${child.officeId}::${child.branch}`} className="bg-bg-canvas/60 hover:bg-bg-canvas transition-colors text-slate-600 italic">
                                      <td className="p-1.5 pl-8 border border-slate-300">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1 h-1 rounded-full bg-slate-300" />
                                          <span>{child.branch}</span>
                                        </div>
                                      </td>
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.total_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'total_calls')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('total_calls', `${child.branch} - Total Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.solved_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'solved_calls')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('solved_calls', `${child.branch} - Solved Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.cancelled_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'cancelled_calls')} className="p-1.5 text-[10px] text-rose-600" onClick={() => handleDrillDown('cancelled_calls', `${child.branch} - Cancelled Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.open_calls)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'open_calls')} className="p-1.5 text-[10px] ui-label" onClick={() => handleDrillDown('open_calls', `${child.branch} - Open Calls`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_2)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_2')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_2', `${child.branch} - <2 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_3)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_3')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_3', `${child.branch} - 2-7 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_7)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_7')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_7', `${child.branch} - 7-15 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.age_15)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'age_15')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('age_15', `${child.branch} - >15 Days`, { officeId: child.officeId })} />
                                      <SummaryMergedMetricCell mergeSelection={mergeFlags} crm={Number(child.part_pending)} client={findBranchRowMetric(clientSummaryData, region, child.branch, 'part_pending')} className="p-1.5 text-[10px]" onClick={() => handleDrillDown('part_pending', `${child.branch} - Part Pending`, { officeId: child.officeId })} />
                                      <td className="p-1.5 border border-slate-300 text-center text-[10px]">
                                        <span className="text-blue-600 ui-strong">{child.active_eng}</span>
                                        <span className="text-slate-400 ml-1">/ {child.headcount}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        );
                      })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
          </ReportErrorBoundary>
    </>
  );
}
