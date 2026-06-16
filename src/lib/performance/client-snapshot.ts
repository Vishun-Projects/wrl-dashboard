import type {
  PerformanceLogLongTask,
  PerformanceLogSlowResource,
  PerformanceLogVital,
} from '@/lib/performance/log-types';

export function readNavigationTimingSnapshot(): Record<string, number | undefined> | null {
  if (typeof performance === 'undefined') return null;
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

export function readResourceSummarySnapshot(): {
  count: number;
  totalTransferSize: number;
  slowest: PerformanceLogSlowResource[];
} {
  if (typeof performance === 'undefined') {
    return { count: 0, totalTransferSize: 0, slowest: [] };
  }

  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const slowest = [...resources]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 15)
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

export type ClientVitalStore = Map<string, PerformanceLogVital>;

export function vitalFromMetric(metric: {
  name: string;
  value: number;
  rating: string;
  id: string;
  navigationType?: string;
}): PerformanceLogVital {
  return {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  };
}

export function mergeLongTasks(
  prev: PerformanceLogLongTask[],
  incoming: PerformanceLogLongTask[],
  max = 30
): PerformanceLogLongTask[] {
  return [...prev, ...incoming].slice(-max);
}
