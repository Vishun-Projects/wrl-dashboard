'use client';

import { useCallback, useRef } from 'react';
import axios from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookieAuthRequestConfig } from '@/lib/api/cookie-auth';
import {
  readRegisterFromPostgresClient,
  registerPostgresHotPathAvailable,
} from '@/lib/read-model/client-flags';
import {
  joinFilterParam,
  resolveViewCallTypesParam,
  toDateString,
  type ReportFilterSnapshot,
} from '@/features/report/lib/filters';

export function useRegisterFilterOptions(
  supabase: SupabaseClient,
  appliedFilters: ReportFilterSnapshot | null,
  setters: {
    setStatesList: (v: Array<Record<string, unknown>>) => void;
    setCitiesList: (v: Array<Record<string, unknown>>) => void;
    setRegionsList: (v: Array<{ vname: string; call_count?: number }>) => void;
    setAccountsList: (v: Array<{ vname: string; call_count?: number }>) => void;
    setBranchesList: (v: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
    setFranchiseesList: (v: Array<{ ncode: string; vcompanyname: string; call_count?: number }>) => void;
    setTechniciansList: (v: Array<Record<string, unknown>>) => void;
  }
) {
  const loadedRef = useRef(false);

  const loadFilterOptions = useCallback(async () => {
    if (
      !readRegisterFromPostgresClient() ||
      !appliedFilters ||
      !registerPostgresHotPathAvailable(
        toDateString(appliedFilters.dateRange.start),
        toDateString(appliedFilters.dateRange.end)
      ) ||
      loadedRef.current
    ) {
      return;
    }
    loadedRef.current = true;

    try {
      const res = await axios.get('/api/report/filter-options', {
        ...cookieAuthRequestConfig,
        params: {
          startDate: toDateString(appliedFilters.dateRange.start),
          endDate: toDateString(appliedFilters.dateRange.end),
          officeId:
            appliedFilters.selectedOfficeIds.length > 0
              ? appliedFilters.selectedOfficeIds.join(',')
              : 'All',
          callType: resolveViewCallTypesParam(appliedFilters.selectedCallTypes),
          status: joinFilterParam(appliedFilters.selectedStatus),
          pincode: appliedFilters.pincodeSearch || '',
          priority: joinFilterParam(appliedFilters.priorityFilter) || 'all',
          portalFilter: joinFilterParam(appliedFilters.portalFilter) || 'All',
          state: joinFilterParam(appliedFilters.selectedState),
          city: joinFilterParam(appliedFilters.selectedCity),
          region: joinFilterParam(appliedFilters.selectedRegion),
          account: joinFilterParam(appliedFilters.selectedAccount),
          branch: joinFilterParam(appliedFilters.selectedBranch),
          franchisee: joinFilterParam(appliedFilters.selectedFranchisee),
          technician: joinFilterParam(appliedFilters.selectedTechnician),
        },
      });

      if (res.data.statesList) setters.setStatesList(res.data.statesList);
      if (res.data.citiesList) setters.setCitiesList(res.data.citiesList);
      if (res.data.regionsList) setters.setRegionsList(res.data.regionsList);
      if (res.data.accountsList) setters.setAccountsList(res.data.accountsList);
      if (res.data.branchesList) setters.setBranchesList(res.data.branchesList);
      if (res.data.franchiseesList) setters.setFranchiseesList(res.data.franchiseesList);
      if (res.data.techniciansList) setters.setTechniciansList(res.data.techniciansList);
    } catch {
      loadedRef.current = false;
    }
  }, [appliedFilters, setters]);

  const resetFilterOptionsCache = useCallback(() => {
    loadedRef.current = false;
  }, []);

  return { loadFilterOptions, resetFilterOptionsCache };
}
