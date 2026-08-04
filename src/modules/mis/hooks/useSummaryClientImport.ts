'use client';

import { useCallback } from 'react';
import axios from 'axios';
import { sourceCodesToParam, type MisSourceSelection } from '@/modules/mis/client-import';

export interface UseSummaryClientImportProps {
  sourceSelection: MisSourceSelection;
  setClientImportActiveSources: (sources: Array<{ code: string; name: string }>) => void;
  setClientSummaryData: (data: any[]) => void;
  setClientAccountSummaryData: (data: any[]) => void;
  summaryTabLoadRef: React.MutableRefObject<number>;
  resolveClientImportScope: () => { startDate: string; endDate: string; agingAsOf: string } | null;
  refreshClientImportOverlayRef: React.MutableRefObject<
    (scope: { startDate: string; endDate: string; agingAsOf: string }) => Promise<void>
  >;
}

export function useSummaryClientImport({
  sourceSelection,
  setClientImportActiveSources,
  setClientSummaryData,
  setClientAccountSummaryData,
  summaryTabLoadRef,
  resolveClientImportScope,
  refreshClientImportOverlayRef,
}: UseSummaryClientImportProps) {
  const commitClientImportSummary = useCallback(
    (client: {
      clientBranchSummary: any[];
      clientAccountSummary: any[];
      rowsInDateRange: number;
      totalRowsInFiles: number;
    }) => {
      setClientSummaryData(client.clientBranchSummary);
      setClientAccountSummaryData(client.clientAccountSummary);
    },
    [setClientSummaryData, setClientAccountSummaryData]
  );

  const loadClientImportSummaryPayload = useCallback(
    async (scope: { startDate: string; endDate: string; agingAsOf: string }) => {
      const sourceCodes = sourceCodesToParam(sourceSelection.clientSourceCodes);
      try {
        const res = await axios.get('/api/mis-client-import/summary', {
          withCredentials: true,
          params: {
            startDate: scope.startDate,
            endDate: scope.endDate,
            agingAsOf: scope.agingAsOf,
            ...(sourceCodes ? { sourceCodes } : {}),
          },
        });
        return {
          clientBranchSummary: res.data?.clientBranchSummary ?? [],
          clientAccountSummary: res.data?.clientAccountSummary ?? [],
          rowsInDateRange: Number(res.data?.rowsInDateRange ?? 0),
          totalRowsInFiles: Number(res.data?.totalRowsInFiles ?? 0),
        };
      } catch (err) {
        console.warn('Client import summary fetch failed:', err);
        return {
          clientBranchSummary: [],
          clientAccountSummary: [],
          rowsInDateRange: 0,
          totalRowsInFiles: 0,
        };
      }
    },
    [sourceSelection.clientSourceCodes]
  );

  const fetchClientImportSummary = useCallback(
    async (scope?: { startDate: string; endDate: string; agingAsOf: string }): Promise<void> => {
      const genAtStart = summaryTabLoadRef.current;
      const resolvedScope = scope ?? resolveClientImportScope();
      if (!resolvedScope) return;
      const payload = await loadClientImportSummaryPayload(resolvedScope);
      if (genAtStart !== summaryTabLoadRef.current) {
        return;
      }
      commitClientImportSummary(payload);
    },
    [loadClientImportSummaryPayload, resolveClientImportScope, commitClientImportSummary, summaryTabLoadRef]
  );

  const loadClientImportSources = useCallback(async () => {
    try {
      const res = await axios.get<{ sources: Array<{ code: string; name: string }> }>(
        '/api/mis-client-import/sources',
        { withCredentials: true }
      );
      setClientImportActiveSources(res.data.sources ?? []);
    } catch {
      setClientImportActiveSources([]);
    }
  }, [setClientImportActiveSources]);

  // Update refreshOverlay ref on every render with latest bindings
  refreshClientImportOverlayRef.current = async (scope) => {
    if (sourceSelection.clientSourceCodes.length === 0) {
      commitClientImportSummary({
        clientBranchSummary: [],
        clientAccountSummary: [],
        rowsInDateRange: 0,
        totalRowsInFiles: 0,
      });
      return;
    }
    await fetchClientImportSummary(scope);
  };

  return {
    loadClientImportSources,
    loadClientImportSummaryPayload,
    fetchClientImportSummary,
    commitClientImportSummary,
  };
}
