# Athena Reconciliation module (Failed Calls — Athena API)

## Why this exists

CRM **Athena API ingestion failures** land in Postgres; this report matches each failed payload against the call register and classifies outcomes (registered, not registered, multiple matches, invalid data). Ops triage failures, tune reason rules, export CSV, and trigger sync/reconcile from the UI.

```text
/report/athena-reconciliation  →  AthenaReconciliationPageClient
        ↓
GET /api/report/athena-reconciliation  (summary | rows | detail | reason-matrix, format=csv)
POST /api/report/athena-reconciliation  (sync | reconcile)
        ↓
Postgres athena_failed_calls + reconciliation status
        ↓
CRM ingest / reconcile workers in @/lib/read-model/athena-reconciliation
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| CRM fetch, normalize, upsert, reconcile engine | `@/lib/read-model/athena-reconciliation/*` |
| Sync CLI / nightly hooks | `@/lib/read-model/cli.ts`, `nightly.ts` |
| MIS shared date helpers | `@/modules/mis` (`defaultDateRange`, `formatLocalDate`) |
| Auth page id | `athena_reconciliation` (`page_athena_reconciliation`) |
| Thin stubs | `src/app/report/(filters)/athena-reconciliation`, `src/app/api/report/athena-reconciliation` |

## Layout

```text
pages/        AthenaReconciliationPageClient
components/   KPI cards, filter bar, data table, reason matrix, payload/rules modals
server/
  routes/     athena-reconciliation.ts (GET + POST)
  rows.ts     Paginated list + CSV generation
  metrics.ts  Summary KPIs + reason/date matrix
  detail.ts   Single-row payload + match detail
  filter-sql.ts  Shared WHERE builder for list/metrics
types.ts      Filter params, row shapes, status enum
index.ts      Types + page export
```

---

## Core flows

1. Open `/report/athena-reconciliation` with default date range + reason rules (treat-as-registered / excluded lists).
2. `mode=summary` loads KPI cards; `mode=rows` loads paginated table; `mode=detail&id=` opens payload modal.
3. `mode=reason-matrix` powers the failure-reason × date heatmap (requires `matrixStart` / `matrixEnd`).
4. `format=csv` returns gzipped CSV of filtered rows.
5. POST `action=sync` pulls new failures from CRM; `action=reconcile` re-runs register matching (`reprocessAll` optional).

---

## Invariants (easy to break)

1. **Status enum** — `REGISTERED | NOT_REGISTERED | MULTIPLE_MATCHES | INVALID_DATA | ALL`; filter-sql and UI must stay aligned.
2. **Reason rules** — client defaults for `treatAsRegisteredReasons` / `excludedReasons` affect summary counts; changing defaults changes historical comparisons.
3. **List vs metrics** — `filter-sql.ts` is the single WHERE source for rows, summary, matrix, and CSV.
4. **POST is mutating** — sync/reconcile require report auth; heavy work belongs in read-model workers, not duplicated in the route.
5. **Cancelled-calls alias** — `page_athena_reconciliation` also grants `/report/cancelled-calls` access.

---

## Where to look

| Need | Place |
|------|--------|
| Page shell | `pages/AthenaReconciliationPageClient.tsx` |
| Filters / table | `components/AthenaFilterBar.tsx`, `AthenaDataTable.tsx` |
| SQL filters | `server/filter-sql.ts` |
| Sync / reconcile | `@/lib/read-model/athena-reconciliation/sync.ts`, `reconcile.ts` |
| API | `server/routes/athena-reconciliation.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Status / match logic | `@/lib/read-model/athena-reconciliation/reconcile.ts`, `detail.ts`, tests |
| New filter dimension | `types.ts`, `filter-sql.ts`, filter bar, CSV columns |
| CRM payload shape | `normalize.ts`, `crm-fetch.ts`, sync worker |
| Reason rule UX | `AthenaReasonRulesModal.tsx`, summary metrics |
| Permission / path | `rbac-catalog`, app route, API `pageId` |
