export type PerformanceLogVital = {
  name: string;
  value: number;
  rating: string;
  id: string;
  navigationType?: string;
};

export type PerformanceLogLongTask = {
  duration: number;
  startTime: number;
  name: string;
};

export type PerformanceLogSlowResource = {
  name: string;
  duration: number;
  transferSize: number;
  initiatorType: string;
};

export type PerformanceLogEntry = {
  loggedAt: string;
  kind:
    | 'route_session'
    | 'vital'
    | 'insights_snapshot'
    | 'server_timing';
  trigger: string;
  route: string;
  referrer: string;
  environment: string;
  userAgent: string;
  userEmail?: string | null;
  webVitals?: PerformanceLogVital[];
  navigationTiming?: Record<string, number | undefined> | null;
  resourceSummary?: {
    count: number;
    totalTransferSize: number;
    slowest: PerformanceLogSlowResource[];
  };
  longTasks?: PerformanceLogLongTask[];
  server?: unknown;
  serverError?: string | null;
  meta?: Record<string, unknown>;
};

export type PerformanceLogBatch = {
  entries: PerformanceLogEntry[];
};
