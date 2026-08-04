'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';
import { feedback } from '@/lib/ui/feedback';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { clearPortalAuditCache } from '@/modules/mis/services/portal-cache';
import { reportPerf } from '@/modules/mis/services/report-page-helpers';
import type { ReportDrillDownState } from '@/modules/mis/components/ReportPageOverlays';

interface UseReportOverlaysStateProps {
  supabase: SupabaseClient;
  userProfile: any;
  data: any[];
  setData: (updateFn: (prev: any[]) => any[]) => void;
  viewCallTypesParam: string;
  dateRange: { start: Date; end: Date };
  agingAsOf: string;
  getAppliedFiltersSnapshot: () => any;
  resolveSummaryAgingStr: (applied?: any) => string;
}

export function useReportOverlaysState({
  supabase,
  userProfile,
  data,
  setData,
  viewCallTypesParam,
  dateRange,
  agingAsOf: _agingAsOf,
  getAppliedFiltersSnapshot,
  resolveSummaryAgingStr,
}: UseReportOverlaysStateProps) {
  const [, setSelectedCallId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const drillDownControllerRef = useRef<AbortController | null>(null);

  const [drillDown, setDrillDown] = useState<ReportDrillDownState>({
    isOpen: false,
    loading: false,
    data: [],
    type: '',
    title: '',
    params: null,
  });

  useEffect(() => {
    return () => {
      drillDownControllerRef.current?.abort();
    };
  }, []);

  const handleFlagUpdate = useCallback(
    async (id: string, flag: string) => {
      const previousData = data;
      const previousSelected = selectedCall;

      // Optimistic update
      setData((prev) =>
        prev.map((d) => (String(d.id) === String(id) ? { ...d, audit_flag: flag } : d))
      );
      setSelectedCall((prev: any) =>
        prev && String(prev.id) === String(id) ? { ...prev, audit_flag: flag } : prev
      );

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        await axios.post(
          '/api/flags',
          {
            call_id: id,
            flag_type: flag,
            office_id: selectedCall?.nofficeid || undefined,
            vtrnno: selectedCall?.UniqueCallNo || undefined,
          },
          {
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
          }
        );
        clearPortalAuditCache();
      } catch (err) {
        setData(() => previousData);
        setSelectedCall(previousSelected);
        throw err;
      }
    },
    [data, selectedCall, setData, supabase.auth]
  );

  const handlePostComment = useCallback(
    async (id: string, text: string) => {
      const previousData = data;
      const previousSelected = selectedCall;
      const targetCall = data.find((d) => String(d.id) === String(id)) || selectedCall;
      const newComment = {
        author_name: userProfile?.name || 'User',
        comment: text,
        created_at: new Date().toISOString(),
        author_avatar_url: userProfile?.avatar_url || null,
      };

      // Optimistic update
      setData((prev) =>
        prev.map((d) =>
          String(d.id) === String(id)
            ? {
                ...d,
                comments: [newComment, ...(d.comments || [])],
                comment_count: (d.comment_count || 0) + 1,
              }
            : d
        )
      );
      if (selectedCall && String(selectedCall.id) === String(id)) {
        setSelectedCall((prev: any) => ({
          ...prev,
          comments: [newComment, ...(prev.comments || [])],
          comment_count: (prev.comment_count || 0) + 1,
        }));
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        await axios.post(
          '/api/comments',
          { call_id: id, text, office_id: targetCall?.nofficeid },
          {
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
          }
        );
        clearPortalAuditCache();
      } catch (err) {
        setData(() => previousData);
        setSelectedCall(previousSelected);
        throw err;
      }
    },
    [data, selectedCall, setData, supabase.auth, userProfile]
  );

  const handleSelectCall = useCallback(
    async (id: string, row?: Record<string, unknown>) => {
      setSelectedCallId(id);
      setIsDrawerOpen(true);
      const targetCall = row || data.find((d) => String(d.id) === String(id));
      setSelectedCall(
        targetCall
          ? {
              ...targetCall,
              id: String(targetCall.id),
              office_id: targetCall.office_id || String(targetCall.nofficeid || ''),
              customer_name: targetCall.customer_name || targetCall.PartyName,
              branch_name: targetCall.branch_name || targetCall.officename,
              engineer_name: targetCall.engineer_name || targetCall.serviceman,
              vtrnno: targetCall.vtrnno || targetCall.UniqueCallNo,
            }
          : { id }
      );

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const params = new URLSearchParams();
        if (targetCall?.nofficeid) params.append('officeId', String(targetCall.nofficeid));
        if (targetCall?.UniqueCallNo) params.append('vtrnno', targetCall.UniqueCallNo);

        const res = await axios.get(`/api/calls/${id}?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        });
        setSelectedCall({
          ...(targetCall || {}),
          ...res.data,
        });
      } catch (err: any) {
        feedback.actionFailed(
          sanitizeUserFacingMessage(
            String(err.response?.data?.error || 'Failed to load call details')
          )
        );
      }
    },
    [data, supabase.auth]
  );

  const handleDrillDown = useCallback(
    async (type: string, title: string, params: Record<string, unknown>) => {
      if (drillDownControllerRef.current) {
        drillDownControllerRef.current.abort();
      }
      const controller = new AbortController();
      drillDownControllerRef.current = controller;

      setDrillDown((prev) => ({
        ...prev,
        isOpen: true,
        loading: true,
        type,
        title,
        params,
        data: [],
      }));
      const d0 = performance.now();
      reportPerf('drillDown', 'POST /api/report/drilldown start', d0, { type, title });
      try {
        const applied = getAppliedFiltersSnapshot();
        const range = applied?.dateRange ?? dateRange;
        const startDateStr = range.start ? (typeof range.start === 'string' ? range.start : range.start.toISOString().split('T')[0]) : '';
        const endDateStr = range.end ? (typeof range.end === 'string' ? range.end : range.end.toISOString().split('T')[0]) : '';
        const agingStr = resolveSummaryAgingStr(applied);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const res = await axios.post(
          '/api/report/drilldown',
          {
            type,
            callType: params.callType || viewCallTypesParam,
            ...params,
            officeId: params.officeId != null ? String(params.officeId) : undefined,
            startDate: startDateStr,
            endDate: endDateStr,
            agingAsOf: agingStr,
          },
          {
            withCredentials: true,
            headers: session?.access_token
              ? {
                  Authorization: `Bearer ${session.access_token}`,
                }
              : undefined,
            signal: controller.signal,
          }
        );
        setDrillDown((prev) => ({ ...prev, loading: false, data: res.data.data }));
        reportPerf('drillDown', 'POST /api/report/drilldown complete', d0, {
          rowCount: (res.data.data || []).length,
        });
      } catch (err: any) {
        if (axios.isCancel(err)) return;
        feedback.actionFailed('Failed to fetch details');
        setDrillDown((prev) => ({ ...prev, loading: false }));
      }
    },
    [getAppliedFiltersSnapshot, dateRange, resolveSummaryAgingStr, supabase.auth, viewCallTypesParam]
  );

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setSelectedCall(null);
    setSelectedCallId(null);
  }, []);

  return {
    selectedCall,
    isDrawerOpen,
    setIsDrawerOpen,
    drillDown,
    setDrillDown,
    handleFlagUpdate,
    handlePostComment,
    handleSelectCall,
    handleDrillDown,
    handleCloseDrawer,
  };
}
