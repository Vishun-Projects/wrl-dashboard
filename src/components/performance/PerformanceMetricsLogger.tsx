'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import axios from 'axios';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { performanceLogEnabledClient } from '@/lib/performance/log-config';
import type { PerformanceLogEntry, PerformanceLogLongTask } from '@/lib/performance/log-types';
import {
  mergeLongTasks,
  readNavigationTimingSnapshot,
  readResourceSummarySnapshot,
  vitalFromMetric,
  type ClientVitalStore,
} from '@/lib/performance/client-snapshot';

const FLUSH_INTERVAL_MS = 45_000;

async function postPerformanceLog(entries: PerformanceLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await axios.post('/api/admin/performance-log', { entries }, { withCredentials: true });
  } catch {
    /* logging must not break the app */
  }
}

function postPerformanceLogBeacon(entries: PerformanceLogEntry[]): void {
  if (entries.length === 0 || typeof navigator === 'undefined') return;
  try {
    const blob = new Blob([JSON.stringify({ entries })], { type: 'application/json' });
    navigator.sendBeacon('/api/admin/performance-log', blob);
  } catch {
    /* ignore */
  }
}

function buildRouteSessionEntry(
  route: string,
  trigger: string,
  vitals: ClientVitalStore,
  longTasks: PerformanceLogLongTask[]
): PerformanceLogEntry {
  return {
    loggedAt: new Date().toISOString(),
    kind: 'route_session',
    trigger,
    route,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    environment: process.env.NODE_ENV ?? 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    webVitals: Array.from(vitals.values()),
    navigationTiming: readNavigationTimingSnapshot(),
    resourceSummary: readResourceSummarySnapshot(),
    longTasks,
  };
}

function buildVitalEntry(route: string, metric: Metric): PerformanceLogEntry {
  return {
    loggedAt: new Date().toISOString(),
    kind: 'vital',
    trigger: `vital:${metric.name}`,
    route,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    environment: process.env.NODE_ENV ?? 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    webVitals: [vitalFromMetric(metric)],
  };
}

/** Collects Web Vitals, navigation timing, resources, and long tasks; writes JSONL via API. */
export function PerformanceMetricsLogger() {
  const pathname = usePathname() ?? '/';
  const routeRef = useRef(pathname);
  const vitalsRef = useRef<ClientVitalStore>(new Map());
  const longTasksRef = useRef<PerformanceLogLongTask[]>([]);
  const pendingRef = useRef<PerformanceLogEntry[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enqueue = useCallback((entry: PerformanceLogEntry) => {
    pendingRef.current.push(entry);
  }, []);

  const flush = useCallback(
    async (useBeacon = false) => {
      const batch = pendingRef.current.splice(0, pendingRef.current.length);
      if (batch.length === 0) return;
      if (useBeacon) {
        postPerformanceLogBeacon(batch);
      } else {
        await postPerformanceLog(batch);
      }
    },
    []
  );

  const flushRouteSession = useCallback(
    (trigger: string, route: string) => {
      enqueue(
        buildRouteSessionEntry(
          route,
          trigger,
          vitalsRef.current,
          longTasksRef.current
        )
      );
      longTasksRef.current = [];
    },
    [enqueue]
  );

  useEffect(() => {
    if (!performanceLogEnabledClient()) return;

    const recordVital = (metric: Metric) => {
      const vital = vitalFromMetric(metric);
      vitalsRef.current.set(vital.name, vital);
      enqueue(buildVitalEntry(routeRef.current, metric));
    };

    onCLS(recordVital);
    onFCP(recordVital);
    onINP(recordVital);
    onLCP(recordVital);
    onTTFB(recordVital);
  }, [enqueue]);

  useEffect(() => {
    if (!performanceLogEnabledClient()) return;
    if (typeof PerformanceObserver === 'undefined') return;

    try {
      const observer = new PerformanceObserver((list) => {
        const incoming = list.getEntries().map((entry) => ({
          duration: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
          name: entry.name,
        }));
        longTasksRef.current = mergeLongTasks(longTasksRef.current, incoming);
      });
      observer.observe({ type: 'longtask', buffered: true });
      return () => observer.disconnect();
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!performanceLogEnabledClient()) return;

    flushTimerRef.current = setInterval(() => {
      flushRouteSession('interval', routeRef.current);
      void flush(false);
    }, FLUSH_INTERVAL_MS);

    const onHide = () => {
      flushRouteSession('pagehide', routeRef.current);
      void flush(true);
    };

    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);

    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flush, flushRouteSession]);

  useEffect(() => {
    if (!performanceLogEnabledClient()) return;

    const prevRoute = routeRef.current;
    if (prevRoute !== pathname) {
      flushRouteSession('route_change', prevRoute);
      void flush(false);
      routeRef.current = pathname;
    }
  }, [pathname, flush, flushRouteSession]);

  return null;
}

/** Log a full insights snapshot (server + client) to the performance JSONL file. */
export async function logInsightsSnapshot(payload: {
  route: string;
  trigger: string;
  webVitals: PerformanceLogEntry['webVitals'];
  navigationTiming: PerformanceLogEntry['navigationTiming'];
  resourceSummary: PerformanceLogEntry['resourceSummary'];
  longTasks: PerformanceLogEntry['longTasks'];
  server: unknown;
  serverError: string | null;
}): Promise<void> {
  if (!performanceLogEnabledClient()) return;

  const entry: PerformanceLogEntry = {
    loggedAt: new Date().toISOString(),
    kind: 'insights_snapshot',
    trigger: payload.trigger,
    route: payload.route,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    environment: process.env.NODE_ENV ?? 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    webVitals: payload.webVitals,
    navigationTiming: payload.navigationTiming,
    resourceSummary: payload.resourceSummary,
    longTasks: payload.longTasks,
    server: payload.server,
    serverError: payload.serverError,
  };

  await postPerformanceLog([entry]);
}
