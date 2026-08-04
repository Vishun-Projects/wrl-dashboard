# Performance Insights module

## Why this exists

Privileged ops need one view of client Web Vitals + server/read-model snapshot, plus optional JSONL ingest, to debug slow pages without wiring every route to a third-party APM.

```text
/admin/performance-insights  →  Panel + PerformanceMetricsLogger
        ↓
POST /api/admin/performance-log   (vitals / route sessions)
GET  /api/admin/performance-log
GET  /api/admin/performance-snapshot  (env flags + sync progress)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Access gate | `@/lib/auth/insights-access.ts` (`page_performance_insights`) |
| Sync progress payload | `@/lib/read-model/sync-meta` |
| Thin stubs | `src/app/admin/performance-insights`, `api/admin/performance-*` |

## Layout

```text
pages/        PerformanceInsightsPageClient
components/   Insights panel, metrics logger (beacon)
lib/          Log config, types, server append/read, snapshot helpers
server/routes/  performance-log, performance-snapshot
```

---

## Core flows

1. Privileged user opens Performance Insights.
2. Panel + logger collect vitals / route sessions (no-op when logging flag off).
3. Client POSTs batches to performance-log; UI GETs log + snapshot.
4. Snapshot merges env read flags + `getReadModelProgress()` (cached ~45–60s).

---

## Invariants (easy to break)

1. Unauthorized **GET** returns **404** (not 403) — hide the surface from non-privileged callers.
2. Logging only when `PERFORMANCE_LOG_ENABLED` / `NEXT_PUBLIC_PERFORMANCE_LOG` allow (default on in development).
3. POST batch capped at **50** entries; entries sanitized with server email/env.
4. Snapshot is cached — do not treat as live sync telemetry.
5. Not a general-user feature; client logger must not break the app on failure.

---

## Where to look

| Need | Place |
|------|--------|
| Page | `pages/PerformanceInsightsPageClient.tsx` |
| Panel / beacon | `components/PerformanceInsightsPanel.tsx`, `PerformanceMetricsLogger.tsx` |
| Enable + paths | `lib/log-config.ts`, `log-server.ts` |
| APIs | `server/routes/performance-log.ts`, `performance-snapshot.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Permission / path | `insights-access`, rbac catalog page entry |
| Log shape | Client logger + `sanitizeEntry` + readers |
| Sync fields on snapshot | `getReadModelProgress`, admin sync page |
| 404-hide rule | Both GET handlers (log + snapshot) |
