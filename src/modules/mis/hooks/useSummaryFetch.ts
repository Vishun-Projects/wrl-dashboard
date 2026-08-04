'use client';

import React, { useCallback } from 'react';
import axios from 'axios';
import {
  buildSummaryQueryKey,
  normalizeAgingAsOfDate,
  toDateString,
  resolveAppliedFilterParams,
  type ReportDateRange,
} from '@/modules/mis/services/filters';
import {
  buildSummaryQueryKeyFromSnapshot,
} from '@/modules/mis/services/summary-query-key';
import {
  globalReportCache,
  callCorpusStore,
  distributionDataCache,
} from '@/modules/mis/services/data-store';
import {
  buildCorpusCacheKey,
  buildCorpusViewDateFilter,
  filterCorpusCallsByViewDate,
  getCorpusCallsArray,
} from '@/modules/mis/services/corpus';
import {
  deriveSummaryDashboard,
  diagnoseSummaryDerivation,
} from '@/lib/summary/derive';
import {
  readSummaryFromPostgresClient,
  readRegisterFromPostgresClient,
} from '@/lib/read-model/client-flags';
import {
  corpusSpanDays,
  isApiShapedSummary,
  logSummaryDebug,
} from '@/modules/mis/services/report-page-helpers';
import {
  emptyRegisterViewFilterParts,
} from '@/modules/mis/services/filters';
import { deriveRegisterView } from '@/modules/mis/services/register-view';
import { MAX_CLIENT_CORPUS_DAYS, type RegisterDateFilterColumn } from '@/sql/trhcalls/query';

export interface UseSummaryFetchProps {
  offices: any[];
  selectedCallTypes: string[];
  selectedOfficeIds: string[];
  dateRange: ReportDateRange;
  dateFilterColumn: RegisterDateFilterColumn;
  agingAsOf: string;
  getAppliedFiltersSnapshot: () => any;
  ensureCorpusLoaded: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>;

  summaryOfficeIdsParam: string;
  viewCallTypesParam: string;
  lastSummaryQueryKeyRef: React.MutableRefObject<string | null>;
  summaryTabLoadRef: React.MutableRefObject<number>;
  summaryFilterLoadInFlightRef: React.MutableRefObject<boolean>;
  summaryFilterLoadKeyRef: React.MutableRefObject<string | null>;
  refreshClientImportOverlayRef: React.MutableRefObject<
    (scope: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >;

  setSummaryData: (data: any[]) => void;
  setAccountsData: (data: any[]) => void;
  setGlobalHeadcount: (count: number) => void;

  summaryDataRef: React.MutableRefObject<any[]>;
  accountsDataRef: React.MutableRefObject<any[]>;

  loadClientImportSummaryPayload: (scope: {
    startDate: string;
    endDate: string;
    agingAsOf: string;
  }) => Promise<{
    clientBranchSummary: any[];
    clientAccountSummary: any[];
    rowsInDateRange: number;
    totalRowsInFiles: number;
  }>;
  commitClientImportSummary: (client: {
    clientBranchSummary: any[];
    clientAccountSummary: any[];
    rowsInDateRange: number;
    totalRowsInFiles: number;
  }) => void;
}

export function useSummaryFetch({
  offices,
  selectedCallTypes,
  selectedOfficeIds,
  dateRange,
  dateFilterColumn,
  agingAsOf,
  getAppliedFiltersSnapshot,
  ensureCorpusLoaded,

  summaryOfficeIdsParam,
  viewCallTypesParam,
  lastSummaryQueryKeyRef,
  summaryTabLoadRef,
  summaryFilterLoadInFlightRef,
  summaryFilterLoadKeyRef,
  refreshClientImportOverlayRef,

  setSummaryData,
  setAccountsData,
  setGlobalHeadcount,

  summaryDataRef,
  accountsDataRef,

  loadClientImportSummaryPayload,
  commitClientImportSummary,
}: UseSummaryFetchProps) {
  const resolveSummaryAgingStr = useCallback(
    (applied?: any) => {
      const snap = applied ?? getAppliedFiltersSnapshot();
      return normalizeAgingAsOfDate(snap?.agingAsOf ?? agingAsOf);
    },
    [getAppliedFiltersSnapshot, agingAsOf]
  );

  const buildCurrentSummaryQueryKey = useCallback(() => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    return buildSummaryQueryKeyFromSnapshot({
      offices,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedCallTypes: applied.selectedCallTypes,
      startDateStr: toDateString(applied.dateRange.start),
      endDateStr: toDateString(applied.dateRange.end),
      agingAsOf: applied.agingAsOf,
    });
  }, [getAppliedFiltersSnapshot, offices]);

  const hydrateSummaryFromCache = useCallback((): boolean => {
    const summaryQueryKey = buildCurrentSummaryQueryKey();
    if (!summaryQueryKey) return false;
    const cachedSummary = globalReportCache?.summaryData?.length
      ? globalReportCache.summaryData
      : summaryDataRef.current;
    const cachedAccounts = globalReportCache?.accountsData?.length
      ? globalReportCache.accountsData
      : accountsDataRef.current;

    if (!cachedSummary.length || !isApiShapedSummary(cachedSummary)) {
      return false;
    }

    const exactKeyMatch =
      globalReportCache?.summaryQueryKey === summaryQueryKey ||
      lastSummaryQueryKeyRef.current === summaryQueryKey;

    if (!exactKeyMatch) {
      return false;
    }

    if (summaryDataRef.current !== cachedSummary) setSummaryData(cachedSummary);
    if (accountsDataRef.current !== cachedAccounts) setAccountsData(cachedAccounts || []);
    if (globalReportCache?.globalHeadcount !== undefined) {
      setGlobalHeadcount(globalReportCache.globalHeadcount);
    }
    lastSummaryQueryKeyRef.current = summaryQueryKey;
    return true;
  }, [buildCurrentSummaryQueryKey, setSummaryData, setAccountsData, setGlobalHeadcount, summaryDataRef, accountsDataRef, lastSummaryQueryKeyRef]);

  const commitSummaryResult = useCallback(
    (
      branchSummary: any[],
      accountSummary: any[],
      headcount: number,
      startDateStr: string,
      endDateStr: string,
      agingStr: string,
      appliedOverride?: any
    ) => {
      const applied = appliedOverride ?? getAppliedFiltersSnapshot();
      const summaryQueryKey = applied
        ? buildSummaryQueryKeyFromSnapshot({
            offices,
            selectedBranch: applied.selectedBranch,
            selectedFranchisee: applied.selectedFranchisee,
            selectedCallTypes: applied.selectedCallTypes,
            startDateStr,
            endDateStr,
            agingAsOf: agingStr,
          })
        : buildSummaryQueryKey({
            officeIdsParam: summaryOfficeIdsParam,
            callTypesParam: viewCallTypesParam,
            startDateStr,
            endDateStr,
            agingAsOf: agingStr,
          });

      setSummaryData(branchSummary);
      setAccountsData(accountSummary);
      setGlobalHeadcount(headcount);
      lastSummaryQueryKeyRef.current = summaryQueryKey;

      if (globalReportCache) {
        globalReportCache.summaryData = branchSummary;
        globalReportCache.accountsData = accountSummary;
        globalReportCache.globalHeadcount = headcount;
        globalReportCache.summaryQueryKey = summaryQueryKey;
        globalReportCache.agingAsOf = agingStr;
      }
    },
    [getAppliedFiltersSnapshot, offices, summaryOfficeIdsParam, viewCallTypesParam, setSummaryData, setAccountsData, setGlobalHeadcount, lastSummaryQueryKeyRef]
  );

  const deriveSummaryFromCorpusPayload = useCallback((): {
    branchSummary: any[];
    accountSummary: any[];
    globalHeadcount: number;
    startDateStr: string;
    endDateStr: string;
    agingStr: string;
  } | null => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const { startDateStr, endDateStr, officeIdsParam, viewCallTypesParam: callTypesParam, agingStr } =
      resolveAppliedFilterParams(applied, offices);
    const appliedDateColumn = applied.dateFilterColumn;
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, appliedDateColumn);
    const spanDays = corpusSpanDays(startDateStr, endDateStr);
    const deriveOpts = {
      agingAsOf: agingStr,
      endDate: endDateStr,
      officeIdsParam,
      callTypesParam,
    };
    const store = callCorpusStore;

    if (!store?.calls.size || store.cacheKey !== corpusKey) {
      logSummaryDebug('corpus not ready — summary cannot derive client-side', {
        reason: !store?.calls.size ? 'empty_or_missing_corpus' : 'cache_key_mismatch',
        expectedCorpusKey: corpusKey,
        actualCorpusKey: store?.cacheKey ?? null,
        corpusCallCount: store?.calls.size ?? 0,
        dateRange: `${startDateStr} → ${endDateStr}`,
        spanDays,
        maxClientCorpusDays: MAX_CLIENT_CORPUS_DAYS,
        exceedsCorpusLimit: spanDays > MAX_CLIENT_CORPUS_DAYS,
        officeFilter: officeIdsParam,
        callTypeFilter: callTypesParam,
        nextStep:
          spanDays > MAX_CLIENT_CORPUS_DAYS
            ? 'Will fetch /api/report/summary (full SQL range; client corpus capped at 120 days)'
            : 'Will retry after corpus load or fall back to /api/report/summary',
      });
      return null;
    }

    const calls = filterCorpusCallsByViewDate(getCorpusCallsArray(store), viewDateFilter);
    const viewFilters = emptyRegisterViewFilterParts({
      selectedCallTypes: applied.selectedCallTypes,
      selectedOfficeIds: applied.selectedOfficeIds,
    });
    const { filteredCalls } = deriveRegisterView(calls, viewFilters, viewDateFilter);
    const diagnostic = diagnoseSummaryDerivation(filteredCalls, deriveOpts);
    const { branchSummary, accountSummary, globalHeadcount: headcount } = deriveSummaryDashboard(
      filteredCalls,
      {
        ...deriveOpts,
        officeIdsParam: 'All',
        callTypesParam: 'All',
      }
    );

    logSummaryDebug('derived from corpus', {
      ...diagnostic,
      corpusTruncated: store.truncated ?? false,
      branchRows: branchSummary.length,
      accountRows: accountSummary.length,
      globalHeadcount: headcount,
    });

    return {
      branchSummary,
      accountSummary,
      globalHeadcount: headcount,
      startDateStr,
      endDateStr,
      agingStr,
    };
  }, [getAppliedFiltersSnapshot, offices]);

  const applySummaryFromCorpus = useCallback((): boolean => {
    const payload = deriveSummaryFromCorpusPayload();
    if (!payload) return false;
    commitSummaryResult(
      payload.branchSummary,
      payload.accountSummary,
      payload.globalHeadcount,
      payload.startDateStr,
      payload.endDateStr,
      payload.agingStr
    );
    void refreshClientImportOverlayRef.current({
      startDate: payload.startDateStr,
      endDate: payload.endDateStr,
      agingAsOf: payload.agingStr,
    });
    return payload.branchSummary.length > 0 || (callCorpusStore?.calls.size ?? 0) > 0;
  }, [deriveSummaryFromCorpusPayload, commitSummaryResult, refreshClientImportOverlayRef]);

  const getSharedCallsForScope = useCallback(() => {
    if (!readRegisterFromPostgresClient()) return null;
    const startDateStr = toDateString(dateRange.start);
    const endDateStr = toDateString(dateRange.end);
    const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn);
    if (distributionDataCache?.cacheKey !== corpusKey) return null;
    const calls =
      (distributionDataCache.allCalls?.length ?? 0) > 0
        ? distributionDataCache.allCalls
        : [];
    if (!calls.length) return null;
    return { calls, corpusKey, startDateStr, endDateStr };
  }, [dateRange.start, dateRange.end, dateFilterColumn]);

  const applySummaryFromSharedCalls = useCallback((): boolean => {
    if (!readRegisterFromPostgresClient()) return false;
    const scope = getSharedCallsForScope();
    if (!scope) return false;

    const { calls, startDateStr, endDateStr } = scope;
    const viewDateFilter = buildCorpusViewDateFilter(startDateStr, endDateStr, dateFilterColumn);
    const viewFilters = emptyRegisterViewFilterParts({
      selectedCallTypes,
      selectedOfficeIds,
    });
    const applied = getAppliedFiltersSnapshot();
    const agingStr = normalizeAgingAsOfDate(applied?.agingAsOf ?? agingAsOf);

    const { filteredCalls } = deriveRegisterView(calls, viewFilters, viewDateFilter);
    const { branchSummary, accountSummary, globalHeadcount: headcount } = deriveSummaryDashboard(
      filteredCalls,
      {
        agingAsOf: agingStr,
        endDate: endDateStr,
        officeIdsParam: 'All',
        callTypesParam: 'All',
      }
    );

    logSummaryDebug('derived from shared Postgres bulk cache', {
      bulkRows: calls.length,
      filteredRows: filteredCalls.length,
      branchRows: branchSummary.length,
      accountRows: accountSummary.length,
      globalHeadcount: headcount,
    });

    commitSummaryResult(
      branchSummary,
      accountSummary,
      headcount,
      startDateStr,
      endDateStr,
      agingStr
    );
    void refreshClientImportOverlayRef.current({
      startDate: startDateStr,
      endDate: endDateStr,
      agingAsOf: agingStr,
    });
    return branchSummary.length > 0 || filteredCalls.length > 0;
  }, [getSharedCallsForScope, getAppliedFiltersSnapshot, dateFilterColumn, agingAsOf, selectedCallTypes, selectedOfficeIds, commitSummaryResult, refreshClientImportOverlayRef]);

  const loadSummaryFromApiPayload = useCallback(async () => {
    const applied = getAppliedFiltersSnapshot();
    if (!applied) return null;
    const { startDateStr, endDateStr, officeIdsParam: summaryOfficeIds, viewCallTypesParam: callTypesParam, agingStr } =
      resolveAppliedFilterParams(applied, offices);

    try {
      const res = await axios.get('/api/report/summary', {
        withCredentials: true,
        params: {
          officeId: summaryOfficeIds,
          callType: callTypesParam,
          startDate: startDateStr,
          endDate: endDateStr,
          agingAsOf: agingStr,
        },
      });

      const branchSummary = res.data?.branchSummary ?? [];
      const accountSummary = res.data?.accountSummary ?? [];
      const headcount = Number(res.data?.globalHeadcount ?? 0);

      logSummaryDebug('loaded from /api/report/summary', {
        branchRows: branchSummary.length,
        accountRows: accountSummary.length,
        globalHeadcount: headcount,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIds,
        callTypeFilter: callTypesParam,
      });

      return {
        branchSummary,
        accountSummary,
        globalHeadcount: headcount,
        startDateStr,
        endDateStr,
        agingStr,
      };
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Summary API failed';
      logSummaryDebug('API fallback failed', {
        error: message,
        dateRange: `${startDateStr} → ${endDateStr}`,
        officeFilter: summaryOfficeIds,
        callTypeFilter: callTypesParam,
      });
      return null;
    }
  }, [getAppliedFiltersSnapshot, offices]);

  const commitSummaryLoadBundle = useCallback(
    (
      crm: {
        branchSummary: any[];
        accountSummary: any[];
        globalHeadcount: number;
        startDateStr: string;
        endDateStr: string;
        agingStr: string;
      } | null,
      client: {
        clientBranchSummary: any[];
        clientAccountSummary: any[];
        rowsInDateRange: number;
        totalRowsInFiles: number;
      } | null,
      appliedOverride?: any
    ) => {
      if (crm) {
        commitSummaryResult(
          crm.branchSummary,
          crm.accountSummary,
          crm.globalHeadcount,
          crm.startDateStr,
          crm.endDateStr,
          crm.agingStr,
          appliedOverride
        );
      }
      if (client) {
        commitClientImportSummary(client);
      } else if (crm) {
        void refreshClientImportOverlayRef.current({
          startDate: crm.startDateStr,
          endDate: crm.endDateStr,
          agingAsOf: crm.agingStr,
        });
      }
    },
    [commitSummaryResult, commitClientImportSummary, refreshClientImportOverlayRef]
  );

  const resolveClientImportScope = useCallback(() => {
    const snap = getAppliedFiltersSnapshot();
    if (!snap) return null;
    const { startDateStr, endDateStr, agingStr } = resolveAppliedFilterParams(snap, offices);
    return {
      startDate: startDateStr,
      endDate: endDateStr,
      agingAsOf: agingStr,
    };
  }, [getAppliedFiltersSnapshot, offices]);

  const runSummaryFilterLoad = useCallback(async (generation: number) => {
    const isStale = () => generation !== summaryTabLoadRef.current;

    const applied = getAppliedFiltersSnapshot();
    if (!applied) return;

    const { startDateStr, endDateStr, agingStr } = resolveAppliedFilterParams(applied, offices);
    const appliedDateColumn = applied.dateFilterColumn;
    const loadKey = buildSummaryQueryKeyFromSnapshot({
      offices,
      selectedBranch: applied.selectedBranch,
      selectedFranchisee: applied.selectedFranchisee,
      selectedCallTypes: applied.selectedCallTypes,
      startDateStr,
      endDateStr,
      agingAsOf: agingStr,
    });

    if (summaryFilterLoadInFlightRef.current && summaryFilterLoadKeyRef.current === loadKey) {
      return;
    }

    const clientImportScope = {
      startDate: startDateStr,
      endDate: endDateStr,
      agingAsOf: agingStr,
    };
    const clientImportPromise = loadClientImportSummaryPayload(clientImportScope);

    if (hydrateSummaryFromCache()) {
      const [client] = await Promise.all([clientImportPromise]);
      if (isStale()) return;
      commitSummaryLoadBundle(null, client, applied);
      return;
    }
    summaryFilterLoadInFlightRef.current = true;
    summaryFilterLoadKeyRef.current = loadKey;

    try {
      const crmPromise = (async () => {
        if (readSummaryFromPostgresClient()) {
          return loadSummaryFromApiPayload();
        }

        const corpusKey = buildCorpusCacheKey(startDateStr, endDateStr, appliedDateColumn);
        const hasCorpus =
          callCorpusStore?.cacheKey === corpusKey && (callCorpusStore?.calls.size ?? 0) > 0;

        if (!hasCorpus) {
          await ensureCorpusLoaded({ silent: true });
        }
        if (isStale()) return null;

        const derived = deriveSummaryFromCorpusPayload();
        if (derived) return derived;
        return loadSummaryFromApiPayload();
      })();

      const [crm, client] = await Promise.all([
        crmPromise,
        clientImportPromise,
      ]);
      if (isStale()) return;
      commitSummaryLoadBundle(crm, client, applied);
    } finally {
      if (summaryFilterLoadKeyRef.current === loadKey) {
        summaryFilterLoadInFlightRef.current = false;
        summaryFilterLoadKeyRef.current = null;
      }
    }
  }, [
    getAppliedFiltersSnapshot,
    offices,
    hydrateSummaryFromCache,
    loadClientImportSummaryPayload,
    commitSummaryLoadBundle,
    loadSummaryFromApiPayload,
    deriveSummaryFromCorpusPayload,
    ensureCorpusLoaded,
    summaryTabLoadRef,
    summaryFilterLoadInFlightRef,
    summaryFilterLoadKeyRef,
  ]);

  return {
    resolveSummaryAgingStr,
    buildCurrentSummaryQueryKey,
    hydrateSummaryFromCache,
    commitSummaryResult,
    deriveSummaryFromCorpusPayload,
    applySummaryFromCorpus,
    getSharedCallsForScope,
    applySummaryFromSharedCalls,
    loadSummaryFromApiPayload,
    commitSummaryLoadBundle,
    resolveClientImportScope,
    runSummaryFilterLoad,
  };
}
