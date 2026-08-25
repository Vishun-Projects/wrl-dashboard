'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { RefreshCw, Database, Activity, CheckCircle2, AlertTriangle, Clock, Mail } from 'lucide-react';
import { PageShell, PageLoadingState } from '@/components/layout/PageShell';
import { AdminStatPill, AdminTable, AdminTableCard, AdminTd, AdminTh, AdminThead, AdminTr } from '@/components/admin/AdminUi';
import type { ReadModelProgress } from '@/lib/read-model/sync-meta';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

type SyncStateSortKey = 'entity' | 'status' | 'running' | 'lastRun' | 'rowsUpserted';
type RecentRunSortKey = 'id' | 'entity' | 'status' | 'upserted' | 'duration' | 'started';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function PhaseBanner({ phase, message }: { phase: ReadModelProgress['phase']; message: string }) {
  const styles: Record<ReadModelProgress['phase'], { icon: React.ReactNode; className: string; title: string }> = {
    pending_backfill: {
      icon: <Clock className="h-5 w-5" />,
      className: 'border-amber-200 bg-amber-50 text-amber-900',
      title: 'Pending backfill',
    },
    backfilling: {
      icon: <Activity className="h-5 w-5 animate-pulse" />,
      className: 'border-blue-200 bg-blue-50 text-blue-900',
      title: 'Backfill running',
    },
    syncing: {
      icon: <RefreshCw className="h-5 w-5 animate-spin" />,
      className: 'border-blue-200 bg-blue-50 text-blue-900',
      title: 'Sync running',
    },
    ready: {
      icon: <CheckCircle2 className="h-5 w-5" />,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      title: 'Ready',
    },
    error: {
      icon: <AlertTriangle className="h-5 w-5" />,
      className: 'border-rose-200 bg-rose-50 text-rose-900',
      title: 'Error',
    },
  };

  const cfg = styles[phase];

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${cfg.className}`}>
      {cfg.icon}
      <div>
        <p className="text-sm font-semibold">{cfg.title}</p>
        <p className="mt-1 text-sm opacity-90">{message}</p>
      </div>
    </div>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[#0f172a] transition-all duration-500"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

export default function ReadModelSyncPage() {
  const supabase = createClient();
  const [progress, setProgress] = useState<ReadModelProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [misEmailTestTo, setMisEmailTestTo] = useState<string | null>(null);
  const [misEmailSmtpReady, setMisEmailSmtpReady] = useState(false);
  const [misEmailSending, setMisEmailSending] = useState(false);
  const [misEmailResult, setMisEmailResult] = useState<string | null>(null);
  const [misEmailError, setMisEmailError] = useState<string | null>(null);
  const [syncStateSort, setSyncStateSort] = useState<TableSortState<SyncStateSortKey> | null>(null);
  const [recentRunsSort, setRecentRunsSort] = useState<TableSortState<RecentRunSortKey> | null>(null);

  const sortedSyncState = useMemo(() => {
    if (!progress || !syncStateSort) return progress?.syncState ?? [];
    return sortRows(progress.syncState, (row) => {
      switch (syncStateSort.key) {
        case 'entity':
          return row.entity;
        case 'status':
          return row.status ?? '';
        case 'running':
          return row.isRunning;
        case 'lastRun':
          return row.lastRunAt ?? '';
        case 'rowsUpserted':
          return row.rowsUpsertedLast;
        default:
          return '';
      }
    }, syncStateSort.dir);
  }, [progress, syncStateSort]);

  const sortedRecentRuns = useMemo(() => {
    if (!progress || !recentRunsSort) return progress?.recentRuns ?? [];
    return sortRows(progress.recentRuns, (row) => {
      switch (recentRunsSort.key) {
        case 'id':
          return row.id;
        case 'entity':
          return row.entity;
        case 'status':
          return row.status;
        case 'upserted':
          return row.rowsUpserted;
        case 'duration':
          return row.durationMs ?? -1;
        case 'started':
          return row.startedAt ?? '';
        default:
          return '';
      }
    }, recentRunsSort.dir);
  }, [progress, recentRunsSort]);

  const loadMisEmailConfig = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.get('/api/admin/mis-email/test', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      setMisEmailTestTo(res.data.testRecipient ?? null);
      setMisEmailSmtpReady(Boolean(res.data.smtpConfigured));
    } catch {
      setMisEmailTestTo(null);
      setMisEmailSmtpReady(false);
    }
  }, [supabase]);

  const sendMisEmailTest = useCallback(async () => {
    setMisEmailSending(true);
    setMisEmailError(null);
    setMisEmailResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.post(
        '/api/admin/mis-email/test',
        {},
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      const files = (res.data.attachments as string[] | undefined)?.join(', ') ?? 'none';
      setMisEmailResult(
        `Sent to ${res.data.sentTo} (${files}) · scope: ${res.data.scopeLabel} · ${res.data.durationMs}ms`
      );
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to send test MIS email';
      setMisEmailError(message);
    } finally {
      setMisEmailSending(false);
    }
  }, [supabase]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.get('/api/read-model/status', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      setProgress(res.data);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to load status';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
    void loadMisEmailConfig();
    let timer: number | null = null;

    const startPolling = () => {
      if (timer != null) return;
      timer = window.setInterval(() => void load(true), 10000);
    };

    const stopPolling = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void load(true);
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load, loadMisEmailConfig]);

  if (loading && !progress) {
    return (
      <PageShell title="Read Model Sync">
        <PageLoadingState label="Loading sync status…" />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Read Model Sync"
      subtitle="Cached data backfill and sync progress"
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/admin/attendance"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-bg-soft"
          >
            <Activity className="h-3.5 w-3.5" />
            Attendance
          </Link>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-bg-soft disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-bg-canvas p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Mail className="h-4 w-4" />
                MIS email digest
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Sends Summary Dashboard and Key Account MIS Excel files using your account scope.
                Test emails go to{' '}
                <strong>{misEmailTestTo ?? 'vish***@westernequipments.com'}</strong> (not user inboxes).
              </p>
              {!misEmailSmtpReady ? (
                <p className="mt-2 text-xs text-amber-700">
                  Mail not configured — set SMTP_HOST + SMTP_FROM (Gmail app password, or VPS Postfix on
                  127.0.0.1:25).
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void sendMisEmailTest()}
              disabled={misEmailSending || !misEmailSmtpReady}
              className="inline-flex items-center gap-2 rounded-md bg-[#0f172a] px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Mail className={`h-3.5 w-3.5 ${misEmailSending ? 'animate-pulse' : ''}`} />
              {misEmailSending ? 'Sending…' : 'Send test MIS email'}
            </button>
          </div>
          {misEmailResult ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {misEmailResult}
            </div>
          ) : null}
          {misEmailError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {misEmailError}
            </div>
          ) : null}
        </div>

        {progress ? (
          <>
            <PhaseBanner phase={progress.phase} message={progress.message} />

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-bg-canvas p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Database className="h-4 w-4" />
                  Hot register (`calls_latest_hot`)
                </div>
                <ProgressBar percent={progress.hot.percent} label="Backfill progress" />
                <p className="mt-3 text-sm text-slate-600">
                  {progress.hot.count.toLocaleString()} / {progress.hot.target.toLocaleString()} rows
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-bg-canvas p-5 shadow-sm">
                <div className="mb-4 text-sm font-semibold text-slate-800">Summary facts & dimensions</div>
                <div className="flex flex-wrap gap-2">
                  <AdminStatPill label="Fact grains" value={progress.facts.grainCount.toLocaleString()} />
                  <AdminStatPill label="Offices" value={progress.dimensions.offices} />
                  <AdminStatPill label="Engineers" value={progress.dimensions.engineers} />
                  <AdminStatPill label="Call types" value={progress.dimensions.callTypes} />
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  Facts populate after the hot backfill finishes. Dimensions refresh at backfill start.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-bg-canvas p-5 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-slate-800">App read sources</div>
              <div className="flex flex-wrap gap-2">
                <AdminStatPill label="Summary" value={progress.appFlags.summary} />
                <AdminStatPill label="Register" value={progress.appFlags.register} />
                <AdminStatPill label="Distribution" value={progress.appFlags.distribution} />
                <AdminStatPill label="Dims" value={progress.appFlags.dims} />
                <AdminStatPill label="ARCP" value={progress.appFlags.arcp} />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Updated {formatWhen(progress.generatedAt)} · auto-refreshes every 10s
              </p>
            </div>

            <AdminTableCard isEmpty={progress.syncState.length === 0}>
              <AdminTable>
                <AdminThead>
                  <tr>
                    <AdminTh
                      sortable
                      sortKey="entity"
                      sort={syncStateSort}
                      onSort={(k) =>
                        setSyncStateSort((p) => toggleSort(p, k as SyncStateSortKey, 'asc'))
                      }
                    >
                      Entity
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="status"
                      sort={syncStateSort}
                      onSort={(k) =>
                        setSyncStateSort((p) => toggleSort(p, k as SyncStateSortKey, 'asc'))
                      }
                    >
                      Status
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="running"
                      sort={syncStateSort}
                      onSort={(k) =>
                        setSyncStateSort((p) => toggleSort(p, k as SyncStateSortKey, 'desc'))
                      }
                    >
                      Running
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="lastRun"
                      sort={syncStateSort}
                      onSort={(k) =>
                        setSyncStateSort((p) => toggleSort(p, k as SyncStateSortKey, 'desc'))
                      }
                    >
                      Last run
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="rowsUpserted"
                      sort={syncStateSort}
                      onSort={(k) =>
                        setSyncStateSort((p) => toggleSort(p, k as SyncStateSortKey, 'desc'))
                      }
                    >
                      Rows upserted
                    </AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {sortedSyncState.map((row) => (
                    <AdminTr key={row.entity}>
                      <AdminTd>{row.entity}</AdminTd>
                      <AdminTd>{row.status ?? '—'}</AdminTd>
                      <AdminTd>{row.isRunning ? 'Yes' : 'No'}</AdminTd>
                      <AdminTd>{formatWhen(row.lastRunAt)}</AdminTd>
                      <AdminTd>{row.rowsUpsertedLast.toLocaleString()}</AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            </AdminTableCard>

            <AdminTableCard isEmpty={progress.recentRuns.length === 0}>
              <AdminTable>
                <AdminThead>
                  <tr>
                    <AdminTh
                      sortable
                      sortKey="id"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'desc'))
                      }
                    >
                      Run
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="entity"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'asc'))
                      }
                    >
                      Entity
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="status"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'asc'))
                      }
                    >
                      Status
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="upserted"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'desc'))
                      }
                    >
                      Upserted
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="duration"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'desc'))
                      }
                    >
                      Duration
                    </AdminTh>
                    <AdminTh
                      sortable
                      sortKey="started"
                      sort={recentRunsSort}
                      onSort={(k) =>
                        setRecentRunsSort((p) => toggleSort(p, k as RecentRunSortKey, 'desc'))
                      }
                    >
                      Started
                    </AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {sortedRecentRuns.map((row) => (
                    <AdminTr key={row.id}>
                      <AdminTd>#{row.id}</AdminTd>
                      <AdminTd>{row.entity}</AdminTd>
                      <AdminTd>{row.status}</AdminTd>
                      <AdminTd>{row.rowsUpserted.toLocaleString()}</AdminTd>
                      <AdminTd>{formatDuration(row.durationMs)}</AdminTd>
                      <AdminTd>{formatWhen(row.startedAt)}</AdminTd>
                    </AdminTr>
                  ))}
                </tbody>
              </AdminTable>
            </AdminTableCard>

            {progress.recentRuns.some((r) => r.errorMessage) ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                Latest error:{' '}
                {progress.recentRuns.find((r) => r.errorMessage)?.errorMessage}
              </div>
            ) : null}

            <details className="rounded-xl border border-slate-200 bg-bg-canvas p-4 text-sm text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-800">Recent ingest batches</summary>
              <div className="mt-3 space-y-2">
                {progress.recentBatches.length === 0 ? (
                  <p>No batches yet.</p>
                ) : (
                  progress.recentBatches.map((batch) => (
                    <div key={batch.batchId} className="rounded-md bg-bg-soft px-3 py-2 text-xs">
                      <span className="font-medium">{batch.entity}</span> · {batch.status} ·{' '}
                      {batch.rowCount.toLocaleString()} rows · {formatWhen(batch.createdAt)}
                    </div>
                  ))
                )}
              </div>
            </details>

            <div className="rounded-xl border border-slate-200 bg-bg-soft px-4 py-3 text-xs text-slate-600">
              <p className="font-medium text-slate-800">What to do next</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Run the one-time backfill on the server until hot rows reach the target (~139k). This page
                  shows <strong>Ready</strong> when complete.
                </li>
                <li>
                  <strong>Ongoing updates:</strong> keep the sync worker daemon running on the server (see{' '}
                  <code className="rounded bg-bg-canvas px-1">docs/sync.md</code>). Reports read from the local
                  cache once backfill finishes.
                </li>
                <li>
                  Use the <strong>Refresh</strong> button on report pages to pull the latest cached data after
                  sync runs.
                </li>
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
