'use client';

import { useEffect, useCallback } from 'react';
import { subscribeRegisterDelta } from '@/modules/mis/services/sync';
import { mergeRegisterDeltaRecords } from '@/modules/mis/services/register-delta';
import { globalReportCache } from '@/modules/mis/services/data-store';

interface UseRegisterDeltaSyncProps {
  setData: (data: any[]) => void;
  setTotal: (total: number) => void;
  setRegisterSummary: (summary: any) => void;
  setSummaryData: React.Dispatch<React.SetStateAction<any[]>>;
  setAccountsData: React.Dispatch<React.SetStateAction<any[]>>;
  setLastRefreshed: (date: Date) => void;
  dataRef: React.MutableRefObject<any[]>;
  totalRef: React.MutableRefObject<number>;
  registerSummaryRef: React.MutableRefObject<any>;
  summaryDataRef: React.MutableRefObject<any[]>;
  accountsDataRef: React.MutableRefObject<any[]>;
  globalHeadcountRef: React.MutableRefObject<number>;
  registerViewFilterRef: React.MutableRefObject<any>;
  registerPagesCacheRef: React.MutableRefObject<any>;
  persistCurrentCache: any;
  lastSyncedAt: Date | null;
}

export function useRegisterDeltaSync({
  setData,
  setTotal,
  setRegisterSummary,
  setSummaryData,
  setAccountsData,
  setLastRefreshed,
  dataRef,
  totalRef,
  registerSummaryRef,
  summaryDataRef,
  accountsDataRef,
  globalHeadcountRef,
  registerViewFilterRef,
  registerPagesCacheRef,
  persistCurrentCache,
  lastSyncedAt,
}: UseRegisterDeltaSyncProps) {
  const applyRegisterDeltaRecords = useCallback(
    (newRecords: any[], syncTime: Date) => {
      setLastRefreshed(syncTime);
      if (globalReportCache) {
        globalReportCache.lastRefreshed = syncTime;
      }
      if (newRecords.length === 0) return;

      const currentGlobalHeadcount = globalHeadcountRef.current;
      const merged = mergeRegisterDeltaRecords({
        currentData: dataRef.current,
        currentTotal: totalRef.current,
        currentRegisterSummary: registerSummaryRef.current,
        currentSummaryData: summaryDataRef.current,
        currentAccountsData: accountsDataRef.current,
        newRecords,
        filterCtx: registerViewFilterRef.current,
      });

      if (merged.kind === 'noop') return;

      if (merged.kind === 'viewFiltered') {
        setData(merged.updatedData);
        return;
      }

      const {
        updatedData,
        nextTotal,
        nextSummary,
        nextSummaryData,
        nextAccountsData,
      } = merged;

      setData(updatedData);
      setTotal(nextTotal);
      setRegisterSummary(nextSummary);
      setSummaryData(nextSummaryData);
      setAccountsData(nextAccountsData);
      registerPagesCacheRef.current.clear();

      if (globalReportCache) {
        globalReportCache.data = updatedData;
        globalReportCache.total = nextTotal;
        globalReportCache.registerSummary = nextSummary;
        globalReportCache.summaryData = nextSummaryData;
        globalReportCache.accountsData = nextAccountsData;
      }

      persistCurrentCache(
        updatedData,
        nextSummaryData,
        nextAccountsData,
        currentGlobalHeadcount,
        nextTotal,
        nextSummary,
        syncTime
      );
    },
    [
      setData,
      setTotal,
      setRegisterSummary,
      setSummaryData,
      setAccountsData,
      setLastRefreshed,
      globalHeadcountRef,
      dataRef,
      totalRef,
      registerSummaryRef,
      summaryDataRef,
      accountsDataRef,
      registerViewFilterRef,
      registerPagesCacheRef,
      persistCurrentCache,
    ]
  );

  useEffect(() => {
    return subscribeRegisterDelta((records, syncTime) => {
      applyRegisterDeltaRecords(records as any[], syncTime);
    });
  }, [applyRegisterDeltaRecords]);

  useEffect(() => {
    if (lastSyncedAt) {
      setLastRefreshed(lastSyncedAt);
    }
  }, [lastSyncedAt, setLastRefreshed]);

  return {
    applyRegisterDeltaRecords,
  };
}
