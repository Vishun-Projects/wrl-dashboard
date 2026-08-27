'use client';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  GitCompareArrows,
  Download,
  RefreshCw,
} from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { AthenaKpiCards } from '../components/AthenaKpiCards';
import { AthenaFilterBar } from '../components/AthenaFilterBar';
import { AthenaTrendAndBreakdown } from '../components/AthenaTrendAndBreakdown';
import { AthenaDataTable } from '../components/AthenaDataTable';
import { AthenaPayloadModal } from '../components/AthenaPayloadModal';
import { AthenaReasonRulesModal } from '../components/AthenaReasonRulesModal';
import type {
  AthenaFailedNormalizedRow,
  AthenaReconciliationFilterParams,
  AthenaReconciliationSummary,
  AthenaRowsResponse,
} from '../types';

function appendListParam(params: URLSearchParams, key: string, val?: string | string[] | null) {
  if (!val) return;
  if (Array.isArray(val)) {
    const valid = val.filter((v) => Boolean(v) && v !== 'All');
    if (valid.length > 0) params.set(key, valid.join(','));
  } else if (val !== 'All') {
    params.set(key, val);
  }
}

export default function AthenaReconciliationPageClient() {
  const currentYear = new Date().getFullYear();
  const defaultStartDate = `${currentYear}-01-01`;
  const defaultEndDate = new Date().toISOString().slice(0, 10);

  const [filters, setFilters] = useState<AthenaReconciliationFilterParams>({
    status: 'ALL',
    startDate: defaultStartDate,
    endDate: defaultEndDate,
    branches: [],
    clients: [],
    callTypes: [],
    failureReasons: [],
    treatAsRegisteredReasons: [
      'Call is Already Open',
      'CCLID Already Exist',
    ],
    excludedReasons: [
      'Call is Already Open',
      'CCLID Already Exist',
    ],
    page: 1,
    pageSize: 25,
    sortBy: 'callDate',
    sortDir: 'desc',
  });

  const [summary, setSummary] = useState<AthenaReconciliationSummary | null>(null);
  const [rowsData, setRowsData] = useState<AthenaRowsResponse | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState<boolean>(true);
  const [isLoadingRows, setIsLoadingRows] = useState<boolean>(true);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [showCharts, setShowCharts] = useState<boolean>(true);
  const [selectedRow, setSelectedRow] = useState<AthenaFailedNormalizedRow | null>(null);
  const [isReasonRulesOpen, setIsReasonRulesOpen] = useState<boolean>(false);

  // Fetch summary KPI and analytics data
  const loadSummary = useCallback(async () => {
    setIsLoadingSummary(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'summary');
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      appendListParam(params, 'branch', filters.branches || filters.branch);
      appendListParam(params, 'client', filters.clients || filters.client);
      appendListParam(params, 'callType', filters.callTypes || filters.callType);
      appendListParam(params, 'failureReason', filters.failureReasons || filters.failureReason);
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      if (filters.excludedReasons && filters.excludedReasons.length > 0) {
        params.set('excludedReasons', filters.excludedReasons.join(','));
      }
      if (filters.treatAsRegisteredReasons && filters.treatAsRegisteredReasons.length > 0) {
        params.set('treatAsRegisteredReasons', filters.treatAsRegisteredReasons.join(','));
      }

      const res = await axios.get<AthenaReconciliationSummary>(
        `/api/report/athena-reconciliation?${params.toString()}`
      );
      setSummary(res.data);
    } catch (err: any) {
      console.error('Failed to load Athena summary:', err);
      toast.error('Failed to load reconciliation statistics');
    } finally {
      setIsLoadingSummary(false);
    }
  }, [
    filters.startDate,
    filters.endDate,
    filters.branches,
    filters.branch,
    filters.clients,
    filters.client,
    filters.callTypes,
    filters.callType,
    filters.failureReasons,
    filters.failureReason,
    filters.status,
    filters.excludedReasons,
    filters.treatAsRegisteredReasons,
  ]);

  // Fetch paginated failed calls table
  const loadRows = useCallback(async () => {
    setIsLoadingRows(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'rows');
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      appendListParam(params, 'branch', filters.branches || filters.branch);
      appendListParam(params, 'client', filters.clients || filters.client);
      appendListParam(params, 'callType', filters.callTypes || filters.callType);
      appendListParam(params, 'failureReason', filters.failureReasons || filters.failureReason);
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.excludedReasons && filters.excludedReasons.length > 0) {
        params.set('excludedReasons', filters.excludedReasons.join(','));
      }
      if (filters.treatAsRegisteredReasons && filters.treatAsRegisteredReasons.length > 0) {
        params.set('treatAsRegisteredReasons', filters.treatAsRegisteredReasons.join(','));
      }
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (filters.sortDir) params.set('sortDir', filters.sortDir);

      const res = await axios.get<AthenaRowsResponse>(
        `/api/report/athena-reconciliation?${params.toString()}`
      );
      setRowsData(res.data);
    } catch (err: any) {
      console.error('Failed to load Athena rows:', err);
      toast.error('Failed to load failed calls records');
    } finally {
      setIsLoadingRows(false);
    }
  }, [
    filters.startDate,
    filters.endDate,
    filters.branches,
    filters.branch,
    filters.clients,
    filters.client,
    filters.callTypes,
    filters.callType,
    filters.failureReasons,
    filters.failureReason,
    filters.status,
    filters.search,
    filters.excludedReasons,
    filters.treatAsRegisteredReasons,
    filters.page,
    filters.pageSize,
    filters.sortBy,
    filters.sortDir,
  ]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleFilterChange = (updates: Partial<AthenaReconciliationFilterParams>) => {
    setFilters((prev) => ({
      ...prev,
      ...updates,
      page: updates.page ?? 1,
    }));
  };

  const handleResetFilters = () => {
    setFilters({
      status: 'ALL',
      startDate: defaultStartDate,
      endDate: defaultEndDate,
      branch: null,
      branches: [],
      client: null,
      clients: [],
      callType: null,
      callTypes: [],
      failureReason: null,
      failureReasons: [],
      search: '',
      treatAsRegisteredReasons: [
        'Call is Already Open',
        'CCLID Already Exist',
      ],
      excludedReasons: [
        'Call is Already Open',
        'CCLID Already Exist',
      ],
      page: 1,
      pageSize: 25,
      sortBy: 'callDate',
      sortDir: 'desc',
    });
  };

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const params = new URLSearchParams();
      params.set('format', 'csv');
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      appendListParam(params, 'branch', filters.branches || filters.branch);
      appendListParam(params, 'client', filters.clients || filters.client);
      appendListParam(params, 'callType', filters.callTypes || filters.callType);
      appendListParam(params, 'failureReason', filters.failureReasons || filters.failureReason);
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.excludedReasons && filters.excludedReasons.length > 0) {
        params.set('excludedReasons', filters.excludedReasons.join(','));
      }
      if (filters.treatAsRegisteredReasons && filters.treatAsRegisteredReasons.length > 0) {
        params.set('treatAsRegisteredReasons', filters.treatAsRegisteredReasons.join(','));
      }

      const res = await axios.get(`/api/report/athena-reconciliation?${params.toString()}`, {
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      toast.success('CSV Export downloaded successfully');
    } catch (err: any) {
      console.error('CSV export failed:', err);
      toast.error('Failed to export CSV');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return (
    <PageShell
      title={
        <div className="flex items-center gap-2">
          <span>Failed Calls & CRM Reconciliation</span>
          {summary && (
            <span className="hidden sm:inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
              {summary.kpis.totalRecords.toLocaleString()} Records
            </span>
          )}
        </div>
      }
      subtitle={
        summary?.lastReconciledAt
          ? `Last Reconciled: ${new Date(summary.lastReconciledAt).toLocaleString()}`
          : 'Failed CRM ingestion matched to the call register'
      }
      icon={<GitCompareArrows className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
      actions={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExportingCsv}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Download className="h-3 w-3 text-slate-500" />
            <span>{isExportingCsv ? 'Exporting...' : 'Export CSV'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              loadSummary();
              loadRows();
            }}
            className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            title="Refresh data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <PageScrollRegion>
        <div className="w-full space-y-2.5 p-3 sm:p-4">
          {/* 1. Status Metric Filter Cards (Persistent & smooth, zero layout shift) */}
          {!summary ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 w-full">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl border border-slate-200 bg-slate-50/50 animate-pulse dark:border-slate-800 dark:bg-slate-900/50"
                />
              ))}
            </div>
          ) : (
            <div className={isLoadingSummary ? 'opacity-75 transition-opacity' : 'transition-opacity'}>
              <AthenaKpiCards
                kpis={summary.kpis}
                activeStatus={filters.status}
                onSelectStatus={(status) => handleFilterChange({ status: status as any })}
              />
            </div>
          )}

          {/* 2. Visual Analytics & Diagnostics (In View by Default) */}
          {summary && (
            <AthenaTrendAndBreakdown
              summary={summary}
              isCollapsed={!showCharts}
              onToggleCollapse={() => setShowCharts((prev) => !prev)}
              onSelectReason={(reason) => {
                const cur = filters.failureReasons || [];
                const updated = cur.includes(reason) ? cur.filter((r) => r !== reason) : [...cur, reason];
                handleFilterChange({ failureReasons: updated, failureReason: updated });
              }}
            />
          )}

          {/* 3. Unified Filter & Search Toolbar */}
          <AthenaFilterBar
            filters={filters}
            onFilterChange={handleFilterChange}
            onResetFilters={handleResetFilters}
            branchOptions={summary?.byBranch || []}
            clientOptions={summary?.byClient || []}
            callTypeOptions={summary?.byCallType || []}
            failureReasonOptions={summary?.byFailureReason || []}
            onOpenReasonRules={() => setIsReasonRulesOpen(true)}
          />

          {/* 4. Full-Width Audit Data Table */}
          <AthenaDataTable
            rows={rowsData?.rows || []}
            total={rowsData?.total || 0}
            page={filters.page || 1}
            pageSize={filters.pageSize || 25}
            totalPages={rowsData?.totalPages || 1}
            isLoading={isLoadingRows}
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            onPageChange={(page) => handleFilterChange({ page })}
            onPageSizeChange={(pageSize) => handleFilterChange({ pageSize, page: 1 })}
            onSortChange={(col) => {
              if (filters.sortBy === col) {
                handleFilterChange({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' });
              } else {
                handleFilterChange({ sortBy: col, sortDir: 'asc' });
              }
            }}
            onViewDetail={(row) => setSelectedRow(row)}
          />

          {/* 5. Inspection Modal */}
          <AthenaPayloadModal
            row={selectedRow}
            onClose={() => setSelectedRow(null)}
          />

          {/* 6. Failure Reason Rules & Exclusions Modal */}
          <AthenaReasonRulesModal
            isOpen={isReasonRulesOpen}
            onClose={() => setIsReasonRulesOpen(false)}
            availableReasons={summary?.byFailureReason || []}
            treatAsRegisteredReasons={filters.treatAsRegisteredReasons || []}
            excludedReasons={filters.excludedReasons || []}
            onApplyRules={({ treatAsRegisteredReasons, excludedReasons }) => {
              handleFilterChange({
                treatAsRegisteredReasons,
                excludedReasons,
                page: 1,
              });
            }}
          />
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
