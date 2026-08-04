'use client';

import { useEffect } from 'react';
import {
  toDateString,
  emptyRegisterViewFilterParts,
  type ReportDateRange,
  type RegisterPageSize,
} from '@/modules/mis/services/filters';
import { readRegisterFromPostgresClient } from '@/lib/read-model/client-flags';
import { readCorpusMeta } from '@/modules/mis/services/corpus-storage';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  restoreCorpusFromIndexedDB,
  deriveRegisterPageFromCorpus,
  getFilteredCorpusCalls,
} from '@/modules/mis/services/corpus';
import {
  summarizeRegisterRows,
} from '@/modules/mis/services/search';
import { resolveRegisterDateSqlColumn, type RegisterDateFilterColumn } from '@/sql/trhcalls/query';
import {
  getMeta,
  getCallsFromDB,
  reportPerf,
  type ReportIdbCacheParams,
} from '@/modules/mis/services/report-page-helpers';
import { buildRegisterListQueryKeyFromViewFilters } from '@/modules/mis/services/register-query-builders';
import { setGlobalReportCache } from '@/modules/mis/services/data-store';

interface UseRegisterIdbBootstrapProps {
  dbInitialized: boolean;
  setDbInitialized: (val: boolean) => void;
  setData: (data: any[]) => void;
  setSummaryData: React.Dispatch<React.SetStateAction<any[]>>;
  setAccountsData: React.Dispatch<React.SetStateAction<any[]>>;
  setGlobalHeadcount: React.Dispatch<React.SetStateAction<number>>;
  setTotal: (total: number) => void;
  setRegisterSummary: (summary: any) => void;
  setLastRefreshed: (date: Date) => void;
  setLoading: (loading: boolean) => void;
  dateRange: ReportDateRange;
  dateFilterColumn: RegisterDateFilterColumn;
  selectedCallTypes: any[];
  selectedOfficeIds: any[];
  filterRegion: string[];
  filterAccount: string[];
  agingAsOf: string;
  limit: RegisterPageSize;
  registerOfficeIdsParam: string;
  viewCallTypesParam: string;
  summaryOfficeIdsParam: string;
  lastSummaryQueryKeyRef: React.MutableRefObject<string | null>;
  lastRegisterListQueryKeyRef: React.MutableRefObject<string | null>;
  lastKnownRegisterTotalRef: React.MutableRefObject<number>;
  lastAppliedFilterSnapshotRef: React.MutableRefObject<string | null>;
  resolveSummaryAgingStr: (applied?: any) => string;
  buildSummaryQueryKey: (params: any) => string;
}

export function useRegisterIdbBootstrap({
  dbInitialized,
  setDbInitialized,
  setData,
  setSummaryData,
  setAccountsData,
  setGlobalHeadcount,
  setTotal,
  setRegisterSummary,
  setLastRefreshed,
  setLoading,
  dateRange,
  dateFilterColumn,
  selectedCallTypes,
  selectedOfficeIds,
  filterRegion,
  filterAccount,
  agingAsOf,
  limit,
  registerOfficeIdsParam,
  viewCallTypesParam,
  summaryOfficeIdsParam,
  lastSummaryQueryKeyRef,
  lastRegisterListQueryKeyRef,
  lastKnownRegisterTotalRef,
  lastAppliedFilterSnapshotRef,
  resolveSummaryAgingStr,
  buildSummaryQueryKey,
}: UseRegisterIdbBootstrapProps) {
  useEffect(() => {
    const initDBAndCache = async () => {
      const i0 = performance.now();
      reportPerf('initDB', 'IndexedDB bootstrap start', i0, {
        why: 'Reads meta + optional cached calls so UI can paint before network; may schedule fetchDelta.',
      });
      try {
        const tBeforeMeta = performance.now();
        const cacheParams = await getMeta<ReportIdbCacheParams>('cacheParams');
        reportPerf('initDB', 'getMeta(cacheParams) done', i0, {
          hasMeta: !!cacheParams,
          getMetaMs: Number((performance.now() - tBeforeMeta).toFixed(1)),
        });

        const startDateStr = toDateString(dateRange.start);
        const endDateStr = toDateString(dateRange.end);
        if (!readRegisterFromPostgresClient()) {
          const corpusMeta = await readCorpusMeta();
          const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
          if (corpusMeta?.cacheKey === corpusKey && (corpusMeta.callCount ?? 0) > 0) {
            const tBeforeCorpus = performance.now();
            const restored = await restoreCorpusFromIndexedDB(corpusKey);
            reportPerf('initDB', 'corpus IDB restore on reload', i0, {
              callCount: corpusMeta.callCount,
              restored: !!restored,
              restoreMs: Number((performance.now() - tBeforeCorpus).toFixed(1)),
            });
            if (restored) {
              const viewDateFilter = buildCorpusViewDateFilter(
                startDateStr,
                endDateStr,
                dateFilterColumn
              );
              const clearView = emptyRegisterViewFilterParts({
                selectedCallTypes,
                selectedOfficeIds,
              });
              const derived = deriveRegisterPageFromCorpus(
                restored,
                corpusKey,
                clearView,
                1,
                10,
                viewDateFilter
              );
              if (derived) {
                const allFiltered = getFilteredCorpusCalls(clearView, restored, viewDateFilter);
                const registerSummaryRows = summarizeRegisterRows(allFiltered);
                setData(derived.rows);
                setTotal(derived.total);
                setRegisterSummary(registerSummaryRows);
                setLastRefreshed(new Date(restored.lastSyncedAt));
                lastKnownRegisterTotalRef.current = derived.total;
                lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
                  officeIdsParam: registerOfficeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  viewFilters: clearView,
                  agingAsOf: agingAsOf || '',
                  pageLimit: limit,
                });
                lastAppliedFilterSnapshotRef.current = JSON.stringify({
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  selectedCallTypes,
                  selectedOfficeIds,
                  selectedState: clearView.selectedState,
                  selectedCity: clearView.selectedCity,
                  selectedRegion: clearView.selectedRegion,
                  selectedAccount: clearView.selectedAccount,
                  selectedBranch: clearView.selectedBranch,
                  selectedFranchisee: clearView.selectedFranchisee,
                  selectedTechnician: clearView.selectedTechnician,
                  selectedStatus: clearView.selectedStatus,
                  priorityFilter: clearView.priorityFilter,
                  portalFilter: clearView.portalFilter,
                  repairFilter: clearView.repairFilter,
                  agingAsOf,
                  debouncedSearch: '',
                  debouncedPincodeSearch: '',
                });
                setGlobalReportCache({
                  data: derived.rows,
                  summaryData: [],
                  accountsData: [],
                  globalHeadcount: 0,
                  total: derived.total,
                  page: 1,
                  search: '',
                  pincodeSearch: '',
                  selectedOfficeIds,
                  dateRange,
                  dateFilterColumn,
                  filterRegion,
                  filterAccount,
                  selectedCallTypes,
                  registerSummary: registerSummaryRows,
                  lastRefreshed: new Date(restored.lastSyncedAt),
                  agingAsOf,
                  selectedStatus: clearView.selectedStatus,
                  priorityFilter: clearView.priorityFilter,
                  portalFilter: clearView.portalFilter,
                  repairFilter: clearView.repairFilter,
                  selectedState: clearView.selectedState,
                  selectedCity: clearView.selectedCity,
                  selectedRegion: clearView.selectedRegion,
                  selectedAccount: clearView.selectedAccount,
                  selectedBranch: clearView.selectedBranch,
                  selectedFranchisee: clearView.selectedFranchisee,
                  selectedTechnician: clearView.selectedTechnician,
                });
              }
            }
            setLoading(false);
            return;
          }

          if (cacheParams) {
            const officeIdsParam = summaryOfficeIdsParam;

            if (
              cacheParams.startDate === startDateStr &&
              cacheParams.endDate === endDateStr &&
              (cacheParams.dateFilterColumn || 'dtrndate') === dateFilterColumn &&
              cacheParams.officeIds === officeIdsParam &&
              cacheParams.callTypes === viewCallTypesParam
            ) {
              const hydrateFromIdb = async () => {
                const tBeforeCalls = performance.now();
                const cachedCalls = await getCallsFromDB();
                reportPerf('initDB', 'getCallsFromDB done (deferred)', i0, {
                  rowCount: cachedCalls?.length ?? 0,
                  getCallsMs: Number((performance.now() - tBeforeCalls).toFixed(1)),
                });
                if (!cachedCalls?.length) return;
                setData(cachedCalls);
                setSummaryData(cacheParams.summaryData || []);
                setAccountsData(cacheParams.accountsData || []);
                setGlobalHeadcount(cacheParams.globalHeadcount || 0);
                setTotal(cacheParams.total || 0);
                setRegisterSummary(cacheParams.registerSummary || null);

                const refreshedDate = new Date(cacheParams.lastRefreshed ?? Date.now());
                setLastRefreshed(refreshedDate);

                const clearView = emptyRegisterViewFilterParts({
                  selectedCallTypes,
                  selectedOfficeIds,
                });
                setGlobalReportCache({
                  data: cachedCalls,
                  summaryData: cacheParams.summaryData || [],
                  accountsData: cacheParams.accountsData || [],
                  globalHeadcount: cacheParams.globalHeadcount || 0,
                  total: cacheParams.total || 0,
                  page: 1,
                  search: '',
                  pincodeSearch: '',
                  selectedOfficeIds,
                  dateRange,
                  dateFilterColumn: resolveRegisterDateSqlColumn(cacheParams.dateFilterColumn),
                  filterRegion,
                  filterAccount,
                  selectedCallTypes,
                  registerSummary: cacheParams.registerSummary || null,
                  lastRefreshed: refreshedDate,
                  agingAsOf,
                  selectedStatus: clearView.selectedStatus,
                  priorityFilter: clearView.priorityFilter,
                  portalFilter: clearView.portalFilter,
                  repairFilter: clearView.repairFilter,
                  selectedState: clearView.selectedState,
                  selectedCity: clearView.selectedCity,
                  selectedBranch: clearView.selectedBranch,
                  selectedFranchisee: clearView.selectedFranchisee,
                  selectedTechnician: clearView.selectedTechnician,
                  summaryQueryKey: cacheParams.summaryQueryKey ?? undefined,
                });

                if (cacheParams.summaryQueryKey) {
                  lastSummaryQueryKeyRef.current = cacheParams.summaryQueryKey;
                } else if (cacheParams.summaryData?.length) {
                  const agingStr = resolveSummaryAgingStr();
                  lastSummaryQueryKeyRef.current = buildSummaryQueryKey({
                    officeIdsParam,
                    callTypesParam: viewCallTypesParam,
                    startDateStr,
                    endDateStr,
                    agingAsOf: agingStr,
                  });
                }

                lastRegisterListQueryKeyRef.current = buildRegisterListQueryKeyFromViewFilters({
                  officeIdsParam: registerOfficeIdsParam,
                  callTypesParam: viewCallTypesParam,
                  startDateStr,
                  endDateStr,
                  dateFilterColumn,
                  viewFilters: clearView,
                  agingAsOf: agingAsOf || '',
                  pageLimit: limit,
                });

                lastKnownRegisterTotalRef.current = cacheParams.total || 0;

                setLoading(false);
              };
              window.setTimeout(() => {
                void hydrateFromIdb();
              }, 0);
            }
          }
        }
      } catch (err) {
        console.error('Error initializing cache from IndexedDB:', err);
        reportPerf('initDB', 'error', i0, { err: String(err) });
      } finally {
        setDbInitialized(true);
        reportPerf('initDB', 'dbInitialized=true (filter effect can run)', i0, {
          why: 'Gate removed: auto-fetch-on-filter useEffect waits for this flag.',
        });
      }
    };
    if (!dbInitialized) {
      initDBAndCache();
    }
  }, [
    dbInitialized,
    setDbInitialized,
    setData,
    setSummaryData,
    setAccountsData,
    setGlobalHeadcount,
    setTotal,
    setRegisterSummary,
    setLastRefreshed,
    setLoading,
    dateRange,
    dateFilterColumn,
    selectedCallTypes,
    selectedOfficeIds,
    filterRegion,
    filterAccount,
    agingAsOf,
    limit,
    registerOfficeIdsParam,
    viewCallTypesParam,
    summaryOfficeIdsParam,
    lastSummaryQueryKeyRef,
    lastRegisterListQueryKeyRef,
    lastKnownRegisterTotalRef,
    lastAppliedFilterSnapshotRef,
    resolveSummaryAgingStr,
    buildSummaryQueryKey,
  ]);
}
