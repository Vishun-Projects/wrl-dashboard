'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { ReportFetchingBar } from '@/components/report/ReportLoadingFeedback';
import { logInsightsSnapshot } from '@/components/performance/PerformanceMetricsLogger';

type VitalName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

type VitalEntry = {
  name: VitalName;
  value: number;
  rating: Metric['rating'];
  id: string;
  navigationType?: string;
  capturedAt: string;
};

type LongTaskEntry = {
  duration: number;
  startTime: number;
  name: string;
};

type SnapshotPayload = {
  capturedAt: string;
  route: string;
  referrer: string;
  userAgent: string;
  webVitals: VitalEntry[];
  navigationTiming: Record<string, number | undefined> | null;
  resourceSummary: {
    count: number;
    totalTransferSize: number;
    slowest: Array<{
      name: string;
      duration: number;
      transferSize: number;
      initiatorType: string;
    }>;
  };
  longTasks: LongTaskEntry[];
  server: unknown;
  serverError: string | null;
  vercelDashboard: {
    speedInsights: string;
    analytics: string;
  };
};

function formatMs(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)} ms`;
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function ratingClass(rating: Metric['rating']): string {
  if (rating === 'good') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (rating === 'needs-improvement') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-rose-700 bg-rose-50 border-rose-200';
}

function readNavigationTiming(): Record<string, number | undefined> | null {
  const entries = performance.getEntriesByType('navigation');
  const nav = entries[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return null;

  return {
    dns: nav.domainLookupEnd - nav.domainLookupStart,
    tcp: nav.connectEnd - nav.connectStart,
    tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : undefined,
    ttfb: nav.responseStart - nav.requestStart,
    download: nav.responseEnd - nav.responseStart,
    domInteractive: nav.domInteractive - nav.startTime,
    domComplete: nav.domComplete - nav.startTime,
    loadEvent: nav.loadEventEnd - nav.startTime,
  };
}

function readResourceSummary() {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const slowest = [...resources]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10)
    .map((entry) => ({
      name: entry.name,
      duration: Math.round(entry.duration),
      transferSize: entry.transferSize,
      initiatorType: entry.initiatorType,
    }));

  const totalTransferSize = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);

  return {
    count: resources.length,
    totalTransferSize,
    slowest,
  };
}

export function PerformanceInsightsPanel() {
  const pathname = usePathname();
  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  const [longTasks, setLongTasks] = useState<LongTaskEntry[]>([]);
  const [serverSnapshot, setServerSnapshot] = useState<unknown>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const vitalsRef = useRef(vitals);
  const longTasksRef = useRef(longTasks);
  vitalsRef.current = vitals;
  longTasksRef.current = longTasks;

  const vercelProject = process.env.NEXT_PUBLIC_VERCEL_PROJECT_NAME ?? 'wrl-dashboard';
  const vercelDashboard = useMemo(
    () => ({
      speedInsights: `https://vercel.com/${process.env.NEXT_PUBLIC_VERCEL_TEAM_SLUG ?? ''}/${vercelProject}/speed-insights`.replace(
        '//',
        '/'
      ),
      analytics: `https://vercel.com/${process.env.NEXT_PUBLIC_VERCEL_TEAM_SLUG ?? ''}/${vercelProject}/analytics`.replace(
        '//',
        '/'
      ),
    }),
    [vercelProject]
  );

  const recordVital = useCallback((metric: Metric) => {
    setVitals((prev) => {
      const next: VitalEntry = {
        name: metric.name as VitalName,
        value: metric.value,
        rating: metric.rating,
        id: metric.id,
        navigationType: metric.navigationType,
        capturedAt: new Date().toISOString(),
      };
      const filtered = prev.filter((entry) => entry.name !== next.name);
      return [...filtered, next].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  useEffect(() => {
    onCLS(recordVital);
    onFCP(recordVital);
    onINP(recordVital);
    onLCP(recordVital);
    onTTFB(recordVital);
  }, [recordVital]);

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries().map((entry) => ({
          duration: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
          name: entry.name,
        }));
        setLongTasks((prev) => [...prev, ...entries].slice(-20));
      });
      observer.observe({ type: 'longtask', buffered: true });
      return () => observer.disconnect();
    } catch {
      return undefined;
    }
  }, []);

  const loadServerSnapshot = useCallback(async (trigger = 'refresh') => {
    setLoading(true);
    setServerError(null);
    try {
      const res = await axios.get('/api/admin/performance-snapshot', { withCredentials: true });
      setServerSnapshot(res.data);
      void logInsightsSnapshot({
        route: pathname ?? '/admin/performance-insights',
        trigger,
        webVitals: vitalsRef.current,
        navigationTiming: readNavigationTiming(),
        resourceSummary: readResourceSummary(),
        longTasks: longTasksRef.current,
        server: res.data,
        serverError: null,
      });
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.error ?? err.message)
        : 'Failed to load server snapshot';
      setServerError(String(message));
      setServerSnapshot(null);
      void logInsightsSnapshot({
        route: pathname ?? '/admin/performance-insights',
        trigger: `${trigger}:error`,
        webVitals: vitalsRef.current,
        navigationTiming: readNavigationTiming(),
        resourceSummary: readResourceSummary(),
        longTasks: longTasksRef.current,
        server: null,
        serverError: String(message),
      });
    } finally {
      setLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    void loadServerSnapshot('mount');
  }, [loadServerSnapshot]);

  const exportPayload: SnapshotPayload = useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      route: pathname ?? '/',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      webVitals: vitals,
      navigationTiming: readNavigationTiming(),
      resourceSummary: readResourceSummary(),
      longTasks,
      server: serverSnapshot,
      serverError,
      vercelDashboard,
    }),
    [pathname, vitals, longTasks, serverSnapshot, serverError, vercelDashboard]
  );

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    void logInsightsSnapshot({
      route: pathname ?? '/admin/performance-insights',
      trigger: 'copy_json',
      webVitals: vitalsRef.current,
      navigationTiming,
      resourceSummary,
      longTasks: longTasksRef.current,
      server: serverSnapshot,
      serverError,
    });
  };

  const navigationTiming = readNavigationTiming();
  const resourceSummary = readResourceSummary();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Performance Insights</h1>
          <p className="text-sm text-slate-500 mt-1">
            Live client metrics and server health for debugging slow pages. Copy JSON to share with AI.
            {process.env.NODE_ENV === 'development' ? (
              <span className="block mt-1 text-xs text-slate-400">
                Dev metrics append to <code className="text-slate-600">logs/performance/metrics-YYYY-MM-DD.jsonl</code>
                {' '}(run <code className="text-slate-600">npm run performance-log:analyze</code>).
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadServerSnapshot('manual_refresh')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void copyJson()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
          >
            <Copy size={16} />
            {copied ? 'Copied' : 'Copy metrics JSON'}
          </button>
        </div>
      </div>

      <ReportFetchingBar active={loading} label="Refreshing server snapshot…" />

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Core Web Vitals (live)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as VitalName[]).map((name) => {
            const entry = vitals.find((vital) => vital.name === name);
            return (
              <div
                key={name}
                className={`rounded-xl border px-4 py-3 ${entry ? ratingClass(entry.rating) : 'border-slate-200 bg-slate-50 text-slate-500'}`}
              >
                <div className="text-xs uppercase tracking-wide">{name}</div>
                <div className="text-xl font-semibold mt-1">
                  {entry
                    ? name === 'CLS'
                      ? entry.value.toFixed(3)
                      : formatMs(entry.value)
                    : 'waiting…'}
                </div>
                {entry && <div className="text-xs mt-1 capitalize">{entry.rating.replace('-', ' ')}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Navigation timing</h2>
          {navigationTiming ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(navigationTiming).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                  <dt className="text-slate-500">{key}</dt>
                  <dd className="font-medium text-slate-900">{formatMs(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Navigation timing not available yet.</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Resource summary</h2>
          <div className="text-sm text-slate-600 mb-3">
            {resourceSummary.count} resources · {formatBytes(resourceSummary.totalTransferSize)} transferred
          </div>
          <div className="space-y-2">
            {resourceSummary.slowest.map((entry) => (
              <div key={`${entry.name}-${entry.duration}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <div className="font-medium text-slate-800 truncate">{entry.name}</div>
                <div className="text-slate-500 mt-1">
                  {formatMs(entry.duration)} · {formatBytes(entry.transferSize)} · {entry.initiatorType}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Long tasks (&gt;50ms)</h2>
        {longTasks.length === 0 ? (
          <p className="text-sm text-slate-500">No long tasks recorded on this page load yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {longTasks.map((task, index) => (
              <div key={`${task.startTime}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <div className="font-medium text-slate-800">{task.name || 'longtask'}</div>
                <div className="text-slate-500 mt-1">
                  {formatMs(task.duration)} at {formatMs(task.startTime)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Server health snapshot</h2>
        {serverError && <p className="text-sm text-rose-600 mb-3">{serverError}</p>}
        <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(serverSnapshot, null, 2) ?? 'null'}
        </pre>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Vercel dashboards</h2>
        <p className="text-sm text-slate-500 mb-4">
          Speed Insights and Web Analytics aggregate RUM data across all users in the Vercel project.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Vercel project dashboards
            <ExternalLink size={14} />
          </a>
          <span className="text-xs text-slate-400 self-center">
            Open your project → Speed Insights / Analytics tabs after deploy.
          </span>
        </div>
      </section>
    </div>
  );
}
