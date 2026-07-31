'use client';

import { useEffect } from 'react';
import axios from 'axios';
import {
  finishMisEmailSendJobClient,
  getMisEmailSendJobsSnapshot,
  reattachMisEmailSendToasts,
  updateMisEmailSendJobClient,
} from '@/features/mis-email/services/send-job-client';
import { createClient } from '@/lib/supabase/client';
import { getBearerAuthHeaders } from '@/lib/supabase/session';

const POLL_MS = 2000;

type MisEmailSendJobResponse = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  message: string;
  error?: string;
};

async function statusRequestAuth(): Promise<{
  headers: Record<string, string>;
  withCredentials: true;
}> {
  const supabase = createClient();
  try {
    const headers = await getBearerAuthHeaders(supabase);
    return { headers, withCredentials: true };
  } catch {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
      withCredentials: true,
    };
  }
}

async function pollMisEmailSendJobs(): Promise<void> {
  const { activeJobs } = getMisEmailSendJobsSnapshot();
  if (activeJobs.length === 0) return;

  const auth = await statusRequestAuth();

  await Promise.all(
    activeJobs.map(async (job) => {
      try {
        const res = await axios.get<{ job: MisEmailSendJobResponse }>(
          `/api/profile/mis-email/send/status?jobId=${encodeURIComponent(job.jobId)}`,
          auth
        );

        const remote = res.data.job;
        if (remote.status === 'queued' || remote.status === 'running') {
          updateMisEmailSendJobClient(job.jobId, {
            status: remote.status,
            message: remote.message,
          });
          return;
        }

        finishMisEmailSendJobClient(job.jobId, {
          ok: remote.status === 'succeeded',
          message: remote.message,
          error: remote.error,
        });
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          finishMisEmailSendJobClient(job.jobId, {
            ok: false,
            message: 'Send status expired — check your inbox or send again',
          });
          return;
        }
        const message = axios.isAxiosError(err)
          ? err.response?.data?.error || err.message
          : 'Could not check MIS email send status';
        finishMisEmailSendJobClient(job.jobId, {
          ok: false,
          message,
        });
      }
    })
  );
}

/** Polls MIS email send jobs app-wide and drives loading toasts. */
export function MisEmailSendTracker() {
  useEffect(() => {
    reattachMisEmailSendToasts();
    void pollMisEmailSendJobs();
    const interval = window.setInterval(() => void pollMisEmailSendJobs(), POLL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
