'use client';

import { useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { createClient } from '@/lib/supabase/client';
import { ensureFreshAccessToken } from '@/lib/supabase-session';
import {
  postgresAutoSyncEnabled,
  postgresAutoSyncIntervalMs,
} from '@/lib/read-model/client-flags';
import {
  fetchReadModelStatus,
  isCallsHotSyncRunning,
  postIncrementalSyncFromUi,
  waitForReadModelSyncIdle,
} from '@/lib/read-model/trigger-sync-client';

/**
 * CRM -> Postgres incremental sync while the app is open (local + Vercel).
 * Ingest only — report pages read from Postgres on their own schedule.
 */
export function PostgresAutoSync() {
  const supabase = createClient();
  const inFlightRef = useRef(false);

  const runSilentSync = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!postgresAutoSyncEnabled()) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    inFlightRef.current = true;
    try {
      let token: string;
      try {
        token = await ensureFreshAccessToken(supabase);
      } catch {
        return;
      }

      let progress: Awaited<ReturnType<typeof fetchReadModelStatus>>;
      try {
        progress = await fetchReadModelStatus(token);
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.message.includes('timeout'))) {
          return;
        }
        throw err;
      }
      if (isCallsHotSyncRunning(progress)) {
        const idle = await waitForReadModelSyncIdle(token);
        if (!idle) return;
      }

      try {
        await postIncrementalSyncFromUi(token);
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          await waitForReadModelSyncIdle(token);
          return;
        }
        if (axios.isAxiosError(err) && err.response?.status === 503) {
          return;
        }
        /* silent background refresh failure */
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [supabase]);

  useEffect(() => {
    if (!postgresAutoSyncEnabled()) return;

    const intervalMs = postgresAutoSyncIntervalMs();
    void runSilentSync();

    const timer = window.setInterval(() => {
      void runSilentSync();
    }, intervalMs);

    const onVisibility = () => {
      if (!document.hidden) void runSilentSync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runSilentSync]);

  return null;
}
