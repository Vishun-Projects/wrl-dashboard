'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import axios from 'axios';
import { createClient } from '@/lib/supabase/client';
import { feedback } from '@/lib/ui/feedback';
import { CallDetail } from '@/components/calls/CallDetail';
import { useUser } from '@/components/layout/DashboardLayout';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';

export type OpenCallDetailParams = {
  callId?: string;
  trn?: string;
  officeId?: string;
  seed?: Record<string, unknown>;
};

type CallDetailDialogContextType = {
  openCallDetail: (params: OpenCallDetailParams) => void;
  closeCallDetail: () => void;
};

const CallDetailDialogContext = createContext<CallDetailDialogContextType | null>(null);

export function useCallDetailDialog() {
  const context = useContext(CallDetailDialogContext);
  if (!context) {
    throw new Error('useCallDetailDialog must be used within CallDetailDialogProvider');
  }
  return context;
}

function buildInitialCall(params: OpenCallDetailParams) {
  const { callId, trn, officeId, seed } = params;
  const lookupId = callId || trn || '';
  if (seed) {
    return {
      ...seed,
      id: String(seed.id ?? callId ?? lookupId),
      office_id: seed.office_id || String(seed.nofficeid ?? officeId ?? ''),
      customer_name: seed.customer_name || seed.PartyName,
      branch_name: seed.branch_name || seed.officename,
      engineer_name: seed.engineer_name || seed.serviceman,
      vtrnno: seed.vtrnno || seed.UniqueCallNo || trn,
    };
  }
  return {
    id: lookupId,
    office_id: officeId || '',
    vtrnno: trn || '',
  };
}

export function CallDetailDialogProvider({ children }: { children: React.ReactNode }) {
  const { userProfile } = useUser();
  const supabase = createClient();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCall, setSelectedCall] = useState<Record<string, unknown> | null>(null);

  const closeCallDetail = useCallback(() => {
    setIsOpen(false);
    setSelectedCall(null);
  }, []);

  const openCallDetail = useCallback(
    async (params: OpenCallDetailParams) => {
      const { callId, trn, officeId } = params;
      const lookupId = callId || trn || '';
      if (!lookupId) return;

      setIsOpen(true);
      setSelectedCall(buildInitialCall(params));

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const searchParams = new URLSearchParams();
        if (officeId) searchParams.append('officeId', officeId);
        if (trn) searchParams.append('vtrnno', trn);

        const res = await axios.get(
          `/api/calls/${encodeURIComponent(lookupId)}?${searchParams.toString()}`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
        setSelectedCall((prev) => ({
          ...(prev || {}),
          ...res.data,
        }));
      } catch (err: unknown) {
        const message =
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : 'Failed to load call details';
        feedback.actionFailed(sanitizeUserFacingMessage(message));
      }
    },
    [supabase]
  );

  const handleFlagUpdate = useCallback(
    async (id: string, flag: string) => {
      setSelectedCall((prev) =>
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
            office_id: selectedCall?.nofficeid || selectedCall?.office_id || undefined,
            vtrnno: selectedCall?.UniqueCallNo || selectedCall?.vtrnno || undefined,
          },
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
      } catch {
        // ignore
      }
    },
    [selectedCall, supabase]
  );

  const handlePostComment = useCallback(
    async (id: string, text: string) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const newComment = {
          author_name: userProfile?.name || 'User',
          comment: text,
          created_at: new Date().toISOString(),
          author_avatar_url: userProfile?.avatar_url || null,
        };
        setSelectedCall((prev) => {
          if (!prev || String(prev.id) !== String(id)) return prev;
          const comments = Array.isArray(prev.comments) ? prev.comments : [];
          return {
            ...prev,
            comments: [newComment, ...comments],
            comment_count: (Number(prev.comment_count) || 0) + 1,
          };
        });
        await axios.post(
          '/api/comments',
          {
            call_id: id,
            text,
            office_id: selectedCall?.nofficeid || selectedCall?.office_id,
          },
          { headers: { Authorization: `Bearer ${session?.access_token}` } }
        );
      } catch {
        // ignore
      }
    },
    [selectedCall, supabase, userProfile]
  );

  return (
    <CallDetailDialogContext.Provider value={{ openCallDetail, closeCallDetail }}>
      {children}
      {isOpen && selectedCall ? (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={closeCallDetail}
          />
          <div className="relative flex h-[min(760px,92vh)] w-full max-w-[900px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow animate-in zoom-in-95 duration-200">
            <CallDetail
              call={selectedCall}
              onClose={closeCallDetail}
              onFlagUpdate={handleFlagUpdate}
              onPostComment={handlePostComment}
            />
          </div>
        </div>
      ) : null}
    </CallDetailDialogContext.Provider>
  );
}
