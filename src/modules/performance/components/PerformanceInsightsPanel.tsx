'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  RefreshCw,
  Server,
  Terminal,
  Zap,
} from 'lucide-react';
import { ReportFetchingBar } from '@/modules/mis/components/ReportLoadingFeedback';
import { logInsightsSnapshot } from '@/modules/performance/components/PerformanceMetricsLogger';

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

type ServerSnapshotData = {
  capturedAt?: string;
  environment?: string;
  passphraseAuthenticated?: boolean;
  passphraseInvalid?: boolean;
  sshBridgeActive?: boolean;
  telemetrySource?: 'ssh_bridge' | 'http_relay' | 'local_node';
  deployment?: {
    region?: string | null;
    gitCommit?: string | null;
  };
  cpuUsage?: {
    percent: number;
    loadAvg: number[];
    cpuCount: number;
    model: string;
  } | null;
  systemMemory?: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  } | null;
  diskStorage?: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    availableBytes: number;
    usedPercent: number;
  } | null;
  networkTraffic?: {
    rxBytes: number;
    txBytes: number;
  } | null;
  processMemory?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
    heapUsedPercent: number;
  } | null;
  systemInfo?: {
    nodeVersion: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
    systemUptimeSeconds: number;
  } | null;
  readModel?: {
    syncWorkerEnabled?: boolean;
    readCallsFrom?: string | null;
    readRegisterFrom?: string | null;
    readSummaryFrom?: string | null;
    readDistributionFrom?: string | null;
    readArcpFrom?: string | null;
    readDimsFrom?: string | null;
  };
  clientFlags?: Record<string, unknown>;
  sync?: {
    totalCalls?: number;
    syncedCalls?: number;
    progressPercent?: number;
    lastSyncedAt?: string;
  } | null;
  syncError?: string | null;
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

type DiagnosticsSnapshot = {
  navigationTiming: Record<string, number | undefined> | null;
  resourceSummary: ReturnType<typeof readResourceSummary>;
};

function formatMs(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)} ms`;
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
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

function runWhenIdle(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let cancelled = false;
  const run = () => {
    if (!cancelled) cb();
  };

  const win = window as Window & {
    requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(run, { timeout: 1_000 });
    return () => {
      cancelled = true;
      if (typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(id);
    };
  }

  const timeout = window.setTimeout(run, 300);
  return () => {
    cancelled = true;
    window.clearTimeout(timeout);
  };
}

function MiniSparkline({ data, color = '#7c3aed' }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 10);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 120;
  const height = 32;
  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path
        d={`M 0,${height} L ${points} L ${width},${height} Z`}
        fill={`url(#grad-${color})`}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function PerformanceInsightsPanel() {
  const pathname = usePathname();
  const [vitals, setVitals] = useState<VitalEntry[]>([]);
  const [longTasks, setLongTasks] = useState<LongTaskEntry[]>([]);
  const [serverSnapshot, setServerSnapshot] = useState<ServerSnapshotData | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);

  type ServerTarget = 'auto' | 'vps' | 'vercel';

  const [selectedTarget, setSelectedTarget] = useState<ServerTarget>('auto');
  const targetRef = useRef<ServerTarget>('auto');
  targetRef.current = selectedTarget;

  // Historical trend points for sparklines
  const [historyCpu, setHistoryCpu] = useState<number[]>([12, 18, 14, 22, 16, 14, 19, 14]);

  const vitalsRef = useRef(vitals);
  const longTasksRef = useRef(longTasks);
  const diagnosticsRef = useRef<DiagnosticsSnapshot | null>(diagnostics);
  vitalsRef.current = vitals;
  longTasksRef.current = longTasks;
  diagnosticsRef.current = diagnostics;

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

  const collectDiagnostics = useCallback(
    (): DiagnosticsSnapshot => ({
      navigationTiming: readNavigationTiming(),
      resourceSummary: readResourceSummary(),
    }),
    []
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

    let teardownIdle: (() => void) | null = null;
    let observer: PerformanceObserver | null = null;
    try {
      teardownIdle = runWhenIdle(() => {
        observer = new PerformanceObserver((list) => {
          const entries = list.getEntries().map((entry) => ({
            duration: Math.round(entry.duration),
            startTime: Math.round(entry.startTime),
            name: entry.name,
          }));
          setLongTasks((prev) => [...prev, ...entries].slice(-20));
        });
        observer.observe({ type: 'longtask', buffered: true });
      });
      return () => {
        if (teardownIdle) teardownIdle();
        observer?.disconnect();
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    let cancelIdle: (() => void) | null = null;
    const raf = requestAnimationFrame(() => {
      cancelIdle = runWhenIdle(() => {
        setDiagnostics(collectDiagnostics());
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (cancelIdle) cancelIdle();
    };
  }, [collectDiagnostics]);

  const loadServerSnapshot = useCallback(async (trigger = 'refresh', overridePassphrase?: string, overrideTarget?: ServerTarget) => {
    setLoading(true);
    setServerError(null);
    try {
      const activePassphrase = (overridePassphrase ?? '').trim();
      const activeTarget = overrideTarget ?? targetRef.current;
      const res = await axios.get('/api/admin/performance-snapshot', {
        withCredentials: true,
        headers: {
          ...(activePassphrase ? { 'x-vps-passphrase': activePassphrase } : {}),
          'x-telemetry-target': activeTarget,
        },
      });
      const data: ServerSnapshotData = res.data;
      setServerSnapshot(data);

      if (data.cpuUsage?.percent != null) {
        setHistoryCpu((prev) => [...prev.slice(-12), data.cpuUsage!.percent]);
      }

      const nextDiagnostics = collectDiagnostics();
      setDiagnostics(nextDiagnostics);
      void logInsightsSnapshot({
        route: pathname ?? '/admin/performance-insights',
        trigger,
        webVitals: vitalsRef.current,
        navigationTiming: nextDiagnostics.navigationTiming,
        resourceSummary: nextDiagnostics.resourceSummary,
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
      const nextDiagnostics = collectDiagnostics();
      setDiagnostics(nextDiagnostics);
      void logInsightsSnapshot({
        route: pathname ?? '/admin/performance-insights',
        trigger: `${trigger}:error`,
        webVitals: vitalsRef.current,
        navigationTiming: nextDiagnostics.navigationTiming,
        resourceSummary: nextDiagnostics.resourceSummary,
        longTasks: longTasksRef.current,
        server: null,
        serverError: String(message),
      });
    } finally {
      setLoading(false);
    }
  }, [pathname, collectDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    const startLoad = () => {
      if (!cancelled) void loadServerSnapshot('mount');
    };
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(startLoad);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [loadServerSnapshot]);

  const exportPayload: SnapshotPayload = useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      route: pathname ?? '/',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      webVitals: vitals,
      navigationTiming: diagnostics?.navigationTiming ?? null,
      resourceSummary: diagnostics?.resourceSummary ?? { count: 0, totalTransferSize: 0, slowest: [] },
      longTasks,
      server: serverSnapshot,
      serverError,
      vercelDashboard,
    }),
    [pathname, vitals, longTasks, serverSnapshot, serverError, vercelDashboard, diagnostics]
  );

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    void logInsightsSnapshot({
      route: pathname ?? '/admin/performance-insights',
      trigger: 'copy_json',
      webVitals: vitalsRef.current,
      navigationTiming: diagnosticsRef.current?.navigationTiming ?? null,
      resourceSummary: diagnosticsRef.current?.resourceSummary ?? { count: 0, totalTransferSize: 0, slowest: [] },
      longTasks: longTasksRef.current,
      server: serverSnapshot,
      serverError,
    });
  };

  const navigationTiming = diagnostics?.navigationTiming ?? null;
  const resourceSummary = diagnostics?.resourceSummary ?? { count: 0, totalTransferSize: 0, slowest: [] };

  const cpu = serverSnapshot?.cpuUsage;
  const sysMem = serverSnapshot?.systemMemory;
  const disk = serverSnapshot?.diskStorage;
  const net = serverSnapshot?.networkTraffic;
  const procMem = serverSnapshot?.processMemory;
  const sysInfo = serverSnapshot?.systemInfo;
  const readModel = serverSnapshot?.readModel;

  const isVercelServerless = Boolean(
    serverSnapshot?.deployment?.region ||
      (serverSnapshot?.environment === 'production' && !serverSnapshot?.sshBridgeActive)
  );
  const isLinux = sysInfo?.platform === 'linux' || Boolean(serverSnapshot?.passphraseAuthenticated);

  return (
    <div className="space-y-6">
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--theme-fg-primary)] tracking-tight flex items-center gap-2">
            <Activity className="text-indigo-600" size={20} />
            Performance &amp; Hardware Telemetry
          </h1>
          <p className="text-xs text-[var(--theme-fg-muted)] mt-0.5">
            Real-time Hostinger VPS server telemetry, client Core Web Vitals, and network diagnostics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Server Target Selector */}
          <div className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] px-3 py-1.5 text-xs shadow-xs">
            <Server size={14} className="text-indigo-600 shrink-0" />
            <span className="text-[11px] font-medium text-[var(--theme-fg-muted)] hidden sm:inline">Inspect:</span>
            <select
              aria-label="Select Server Telemetry Target"
              value={selectedTarget}
              onChange={(e) => {
                const nextTarget = e.target.value as ServerTarget;
                setSelectedTarget(nextTarget);
                void loadServerSnapshot('target_change', undefined, nextTarget);
              }}
              className="bg-transparent text-xs font-semibold text-[var(--theme-fg-primary)] focus:outline-none cursor-pointer pr-1"
            >
              <option value="auto">⚡ Auto (Prefer VPS)</option>
              <option value="vps">🌐 Hostinger VPS</option>
              <option value="vercel">☁️ Vercel Edge Node</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => void loadServerSnapshot('manual_refresh')}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] px-3 py-1.5 text-xs font-medium text-[var(--theme-fg-secondary)] shadow-xs hover:bg-[var(--theme-bg-muted)] transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh Snapshot
          </button>
          <button
            type="button"
            onClick={() => void copyJson()}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            <Copy size={14} />
            {copied ? 'Copied ✓' : 'Copy JSON'}
          </button>
        </div>
      </div>

      <ReportFetchingBar active={loading} label="Fetching real-time VPS snapshot…" />

      {/* 2-Column Split Layout: Main Content (Left) & Right Sidebar KPIs (Right) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_360px] items-start">

        {/* LEFT MAIN CONTENT AREA: Diagnostics, Web Vitals & JSON */}
        <div className="space-y-6 min-w-0">

          {/* Core Web Vitals Section */}
          <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--theme-fg-primary)] flex items-center gap-2">
                  <Zap size={16} className="text-amber-500" />
                  Core Web Vitals (Live Client)
                </h2>
                <p className="text-xs text-[var(--theme-fg-muted)] mt-0.5">
                  Real user experience metrics captured from your browser session
                </p>
              </div>
              <span className="text-[11px] font-normal text-[var(--theme-fg-tertiary)] bg-[var(--theme-bg-soft)] px-2.5 py-1 rounded-full border border-[var(--theme-border)]">
                Next.js 16 Web Vitals
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as VitalName[]).map((name) => {
                const entry = vitals.find((vital) => vital.name === name);
                return (
                  <div
                    key={name}
                    className={`rounded-2xl border px-3.5 py-3 transition-colors ${
                      entry
                        ? ratingClass(entry.rating)
                        : 'border-[var(--theme-border)] bg-[var(--theme-bg-soft)] text-[var(--theme-fg-muted)]'
                    }`}
                  >
                    <div className="text-[11px] font-medium tracking-wider uppercase opacity-80">{name}</div>
                    <div className="text-lg font-semibold mt-1 tracking-tight">
                      {entry
                        ? name === 'CLS'
                          ? entry.value.toFixed(3)
                          : formatMs(entry.value)
                        : 'waiting…'}
                    </div>
                    {entry ? (
                      <div className="text-[10px] font-medium mt-1 uppercase tracking-wide opacity-90">
                        {entry.rating.replace('-', ' ')}
                      </div>
                    ) : (
                      <div className="text-[10px] text-[var(--theme-fg-tertiary)] mt-1">Pending interaction</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Diagnostics Split Grid */}
          <div className="grid gap-6 md:grid-cols-2">
            
            {/* Navigation Timing */}
            <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-semibold text-[var(--theme-fg-primary)] flex items-center gap-2">
                <Activity size={16} className="text-indigo-500" />
                Navigation Timing
              </h2>
              {navigationTiming ? (
                <dl className="space-y-1.5 text-xs">
                  {Object.entries(navigationTiming).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between border-b border-[var(--theme-border)] pb-1.5">
                      <dt className="text-[var(--theme-fg-muted)] font-normal">{key}</dt>
                      <dd className="font-mono text-[var(--theme-fg-primary)] font-medium">{formatMs(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-[var(--theme-fg-muted)] py-4 text-center">Navigation timing capturing...</p>
              )}
            </section>

            {/* Resource Summary */}
            <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--theme-fg-primary)] flex items-center gap-2">
                  <HardDrive size={16} className="text-emerald-500" />
                  Resource Summary
                </h2>
                <span className="text-[11px] font-normal text-[var(--theme-fg-muted)] font-mono">
                  {resourceSummary.count} assets · {formatBytes(resourceSummary.totalTransferSize)}
                </span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {resourceSummary.slowest.map((entry) => (
                  <div key={`${entry.name}-${entry.duration}`} className="rounded-xl bg-[var(--theme-bg-soft)] p-2.5 text-xs border border-[var(--theme-border)]">
                    <div className="font-medium text-[var(--theme-fg-primary)] truncate font-mono text-[11px]">{entry.name}</div>
                    <div className="text-[var(--theme-fg-muted)] mt-1 flex items-center justify-between text-[10px]">
                      <span>{formatMs(entry.duration)} · {formatBytes(entry.transferSize)}</span>
                      <span className="uppercase tracking-wider font-medium opacity-75">{entry.initiatorType}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Raw Server Snapshot Drawer */}
          <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-5 shadow-xs">
            <button
              type="button"
              onClick={() => setShowRawJson((prev) => !prev)}
              className="flex items-center justify-between w-full text-xs font-semibold text-[var(--theme-fg-secondary)] cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Terminal size={14} className="text-indigo-600" />
                Raw Server Snapshot JSON Payload
              </span>
              {showRawJson ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {serverError && <p className="text-xs text-[var(--theme-danger)] mt-2">{serverError}</p>}
            {showRawJson && (
              <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-[11px] text-emerald-400 font-mono">
                {JSON.stringify(serverSnapshot, null, 2) ?? 'null'}
              </pre>
            )}
          </section>

        </div>

        {/* RIGHT SIDEBAR: Compact VPS Telemetry & KPIs Stack */}
        <div className="space-y-4">

          {/* Hostinger Instance Status Header */}
          <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-4 shadow-xs space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[var(--theme-bg-soft)] border border-[var(--theme-border)] flex items-center justify-center text-lg shadow-xs shrink-0">
                {serverSnapshot?.telemetrySource === 'ssh_bridge' || (serverSnapshot?.sshBridgeActive && serverSnapshot?.telemetrySource !== 'http_relay')
                  ? '⚡'
                  : serverSnapshot?.telemetrySource === 'http_relay'
                  ? '🌐'
                  : isVercelServerless
                  ? '☁️'
                  : isLinux
                  ? '🐧'
                  : '🪟'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-[var(--theme-fg-primary)] truncate">
                    {serverSnapshot?.telemetrySource === 'ssh_bridge'
                      ? 'Hostinger VPS (Live SSH)'
                      : serverSnapshot?.telemetrySource === 'http_relay'
                      ? 'Hostinger VPS (HTTP Relay)'
                      : serverSnapshot?.sshBridgeActive
                      ? 'Hostinger VPS (Remote)'
                      : isVercelServerless
                      ? `Vercel Serverless (${serverSnapshot?.deployment?.region ?? 'ap-south-1'})`
                      : isLinux
                      ? 'Hostinger VPS (Ubuntu)'
                      : 'Local Host'}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--theme-success)] animate-pulse" />
                  <span className="text-[11px] font-medium text-[var(--theme-success)] truncate">
                    {serverSnapshot?.telemetrySource === 'ssh_bridge'
                      ? 'Live SSH Bridge Active'
                      : serverSnapshot?.telemetrySource === 'http_relay'
                      ? 'Live Telemetry Relay Active'
                      : serverSnapshot?.sshBridgeActive
                      ? 'Remote VPS Bridge Active'
                      : isVercelServerless
                      ? 'Cloud Edge Node Active'
                      : isLinux
                      ? 'Hostinger Production'
                      : 'Local Node Active'}
                  </span>
                </div>
              </div>
            </div>

            {/* Target Server Quick Switcher */}
            <div className="pt-2 border-t border-[var(--theme-border)] space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--theme-fg-muted)] flex items-center justify-between">
                <span>Select Telemetry Target:</span>
                <span className="text-[10px] font-bold tracking-wider text-indigo-600 uppercase">
                  {selectedTarget === 'auto' ? 'Auto Mode' : selectedTarget === 'vps' ? 'VPS Target' : 'Vercel Target'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--theme-bg-soft)] p-1 border border-[var(--theme-border)]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTarget('auto');
                    void loadServerSnapshot('target_change', undefined, 'auto');
                  }}
                  className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                    selectedTarget === 'auto'
                      ? 'bg-[var(--theme-bg-canvas)] text-[var(--theme-fg-primary)] shadow-xs font-semibold'
                      : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg-primary)]'
                  }`}
                >
                  ⚡ Auto
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTarget('vps');
                    void loadServerSnapshot('target_change', undefined, 'vps');
                  }}
                  className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                    selectedTarget === 'vps'
                      ? 'bg-[var(--theme-bg-canvas)] text-[var(--theme-fg-primary)] shadow-xs font-semibold'
                      : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg-primary)]'
                  }`}
                >
                  🌐 VPS
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTarget('vercel');
                    void loadServerSnapshot('target_change', undefined, 'vercel');
                  }}
                  className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                    selectedTarget === 'vercel'
                      ? 'bg-[var(--theme-bg-canvas)] text-[var(--theme-fg-primary)] shadow-xs font-semibold'
                      : 'text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg-primary)]'
                  }`}
                >
                  ☁️ Vercel
                </button>
              </div>
            </div>

            <div className="pt-2.5 border-t border-[var(--theme-border)] space-y-1.5 text-xs text-[var(--theme-fg-muted)]">
              <div className="flex items-center justify-between">
                <span>SSH Host:</span>
                <span className="font-mono text-[var(--theme-fg-primary)] font-normal">root@187.127.145.253</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Server Uptime:</span>
                <span className="text-[var(--theme-fg-secondary)]">{formatUptime(sysInfo?.systemUptimeSeconds && sysInfo.systemUptimeSeconds > 0 ? sysInfo.systemUptimeSeconds : sysInfo?.uptimeSeconds)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>App Uptime:</span>
                <span className="text-[var(--theme-fg-secondary)]">{formatUptime(sysInfo?.uptimeSeconds)}</span>
              </div>
            </div>

            <a
              href="https://hpanel.hostinger.com/vps/1745879/overview"
              target="_blank"
              rel="noreferrer"
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] py-2 text-xs font-medium text-[var(--theme-fg-secondary)] hover:bg-[var(--theme-bg-muted)] transition-colors shadow-xs"
            >
              <Terminal size={14} />
              Open Hostinger hPanel
              <ExternalLink size={12} className="text-[var(--theme-fg-tertiary)]" />
            </a>
          </div>

          {/* Compact Telemetry KPIs List */}
          <div className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-bg-canvas)] p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--theme-border)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-fg-muted)]">
                Server Telemetry KPIs
              </span>
              <span className="text-[10px] font-medium text-[var(--theme-success)] bg-[var(--theme-success-bg)] px-2 py-0.5 rounded-full border border-[var(--theme-border)]">
                Real-Time
              </span>
            </div>

            {/* 1. CPU Usage */}
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-normal text-[var(--theme-fg-secondary)] flex items-center gap-1.5">
                  <Cpu size={14} className="text-purple-600" />
                  CPU Usage
                </span>
                <span className="font-semibold text-[var(--theme-fg-primary)] text-sm font-mono">
                  {cpu ? `${cpu.percent}%` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[var(--theme-border)] text-[11px] text-[var(--theme-fg-muted)]">
                <span>Load (1m): {cpu?.loadAvg ? cpu.loadAvg[0]?.toFixed(2) : '—'}</span>
                <span className="font-mono text-[10px]">{cpu ? `${cpu.cpuCount} Cores` : '—'}</span>
              </div>
              {historyCpu.length > 0 && (
                <div className="pt-1 flex justify-end">
                  <MiniSparkline data={historyCpu} color="#7c3aed" />
                </div>
              )}
            </div>

            {/* 2. Memory Usage */}
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-normal text-[var(--theme-fg-secondary)] flex items-center gap-1.5">
                  <Server size={14} className="text-indigo-600" />
                  RAM Usage
                </span>
                <span className="font-semibold text-[var(--theme-fg-primary)] text-sm font-mono">
                  {sysMem ? `${sysMem.usedPercent}%` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--theme-fg-muted)]">
                <span>Used / Total:</span>
                <span className="font-mono text-[10px] font-normal text-[var(--theme-fg-secondary)]">
                  {sysMem ? `${formatBytes(sysMem.usedBytes)} / ${formatBytes(sysMem.totalBytes)}` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[var(--theme-border)] text-[10px] text-[var(--theme-fg-muted)]">
                <span>Node RSS: {procMem ? formatBytes(procMem.rss) : '—'}</span>
                <span>Heap: {procMem ? formatBytes(procMem.heapUsed) : '—'}</span>
              </div>
            </div>

            {/* 3. Disk Storage */}
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-normal text-[var(--theme-fg-secondary)] flex items-center gap-1.5">
                  <HardDrive size={14} className="text-indigo-600" />
                  Disk Storage
                </span>
                <span className="font-semibold text-indigo-600 text-sm font-mono">
                  {disk ? `${disk.usedPercent}%` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-[var(--theme-fg-muted)]">
                <span>Capacity:</span>
                <span className="font-mono text-[11px] font-medium text-[var(--theme-fg-primary)]">
                  {disk ? `${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}` : 'Unavailable'}
                </span>
              </div>
              <div className="text-[10px] text-[var(--theme-fg-muted)] pt-1 border-t border-[var(--theme-border)] flex justify-between">
                <span>Free Space:</span>
                <span className="font-mono font-normal text-[var(--theme-fg-secondary)]">{disk ? formatBytes(disk.freeBytes) : '—'}</span>
              </div>
            </div>

            {/* 4. Incoming & Outgoing Traffic Grid */}
            <div className="grid grid-cols-2 gap-2">
              {/* Incoming RX */}
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-2.5 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-normal text-[var(--theme-fg-muted)]">
                  <span className="flex items-center gap-1">
                    <ArrowDownLeft size={12} className="text-rose-500" /> RX Traffic
                  </span>
                </div>
                <div className="text-sm font-semibold text-[var(--theme-fg-primary)] font-mono">
                  {net ? formatBytes(net.rxBytes) : '0 B'}
                </div>
                <div className="text-[9px] text-[var(--theme-fg-tertiary)]">Net RX counter</div>
              </div>

              {/* Outgoing TX */}
              <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-2.5 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-normal text-[var(--theme-fg-muted)]">
                  <span className="flex items-center gap-1">
                    <ArrowUpRight size={12} className="text-indigo-600" /> TX Traffic
                  </span>
                </div>
                <div className="text-sm font-semibold text-[var(--theme-fg-primary)] font-mono">
                  {net ? formatBytes(net.txBytes) : '0 B'}
                </div>
                <div className="text-[9px] text-[var(--theme-fg-tertiary)]">Net TX counter</div>
              </div>
            </div>

            {/* 5. Host OS & Node Platform */}
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-normal text-[var(--theme-fg-secondary)]">Host OS Platform</span>
                <span className="text-[10px] font-mono text-[var(--theme-fg-muted)]">{sysInfo?.arch ?? 'x64'}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--theme-fg-primary)]">
                <span className="capitalize">{sysInfo?.platform ?? 'Linux'}</span>
                <span className="text-[11px] font-normal text-[var(--theme-fg-muted)] font-mono">Node {sysInfo?.nodeVersion ?? 'v25.9.0'}</span>
              </div>
            </div>

            {/* 6. Database Read Model Sources */}
            <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-soft)] p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between font-normal text-[var(--theme-fg-secondary)]">
                <span className="flex items-center gap-1.5">
                  <Database size={14} className="text-purple-600" />
                  Read Model
                </span>
                <span className="text-[10px] font-medium text-[var(--theme-success)] bg-[var(--theme-success-bg)] px-2 py-0.5 rounded-full border border-[var(--theme-border)]">
                  {readModel?.syncWorkerEnabled ? 'Sync Worker Active' : 'Read-Model Ready'}
                </span>
              </div>
              <div className="space-y-1 text-[11px] text-[var(--theme-fg-muted)]">
                <div className="flex justify-between">
                  <span>Calls Source:</span>
                  <span className="font-mono text-[var(--theme-fg-primary)] uppercase font-medium">{readModel?.readCallsFrom ?? 'postgres'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Register Source:</span>
                  <span className="font-mono text-[var(--theme-fg-primary)] uppercase font-medium">{readModel?.readRegisterFrom ?? 'postgres'}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
