'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBearerAuthHeaders } from '@/lib/supabase/session';
import {
  joinFilterParam,
  resolveViewCallTypesParam,
  toDateString,
  type ReportFilterSnapshot,
} from '@/lib/report/filters';

type DistributionSummaryState = {
  calls: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
};

export function useDistributionSummary(
  supabase: SupabaseClient,
  appliedFilters: ReportFilterSnapshot | null,
  appliedRevision: number
) {
  const [state, setState] = useState<DistributionSummaryState>({
    calls: [],
    loading: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    if (!appliedFilters) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const headers = await getBearerAuthHeaders(supabase);
      const startDate = toDateString(appliedFilters.dateRange.start);
      const endDate = toDateString(appliedFilters.dateRange.end);
      const officeId =
        appliedFilters.selectedOfficeIds.length > 0
          ? appliedFilters.selectedOfficeIds.join(',')
          : 'All';

      const res = await axios.get('/api/report/distribution-summary', {
        headers,
        signal: controller.signal,
        params: {
          startDate,
          endDate,
          officeId,
          callType: resolveViewCallTypesParam(appliedFilters.selectedCallTypes),
          status: joinFilterParam(appliedFilters.selectedStatus),
          pincode: appliedFilters.pincodeSearch || '',
          priority: joinFilterParam(appliedFilters.priorityFilter) || 'all',
          portalFilter: joinFilterParam(appliedFilters.portalFilter) || 'All',
          state: joinFilterParam(appliedFilters.selectedState),
          city: joinFilterParam(appliedFilters.selectedCity),
          branch: joinFilterParam(appliedFilters.selectedBranch),
          franchisee: joinFilterParam(appliedFilters.selectedFranchisee),
          technician: joinFilterParam(appliedFilters.selectedTechnician),
        },
      });

      if (generation !== generationRef.current) return;

      setState({
        calls: (res.data?.calls ?? []) as Record<string, unknown>[],
        loading: false,
        error: null,
      });
    } catch (err: unknown) {
      if (axios.isCancel(err)) return;
      if (generation !== generationRef.current) return;
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Failed to load distribution data';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [appliedFilters, supabase]);

  useEffect(() => {
    void fetchSummary();
    return () => abortRef.current?.abort();
  }, [fetchSummary, appliedRevision]);

  return { ...state, refetch: fetchSummary };
}
