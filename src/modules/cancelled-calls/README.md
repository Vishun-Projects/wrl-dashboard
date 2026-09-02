# Cancelled Calls module

## Why this exists

Branch-scoped **cancelled call register** from Postgres (`calls_cancelled` hot table). Ops review cancellations by date range, branch, franchisee, party profile, and call type — with paginated rows, summary KPIs, CSV download, and Excel workbooks for the daily digest.

```text
/report/cancelled-calls  →  CancelledCallsPageClient
        ↓
GET /api/report/cancelled-calls  (mode=rows|summary|options, format=csv)
        ↓
Postgres calls_cancelled + office-scope filter
        ↓
Optional item-code enrichment from CRM
```

Digest path (yesterday IST, per-branch Excel): `mis-email` imports `fetchCancelledCallsForDigestDay` + `excel-export` from this module.

## What is *not* here

| Concern | Lives in |
|---------|----------|
| CRM → Postgres cancelled sync | `@/lib/read-model/cancelled-call-register/*` |
| Hot table schema / entity id | `@/lib/read-model/cancelled-call-register/constants` |
| Digest scheduler, recipients, send | `@/modules/mis-email` (`cancelled-call-digest.ts`, `server/sync/cancelled-call-digest-recipients`) |
| Shared date/filter widgets | `@/modules/mis/register/components/*`, `@/modules/mis` date helpers |
| Auth page id | `cancelled_calls` (`page_cancelled_calls`; Athena permission also grants access) |
| Thin stubs | `src/app/report/cancelled-calls`, `src/app/api/report/cancelled-calls` |

## Layout

```text
pages/           CancelledCallsPageClient
server/
  routes/        cancelled-calls.ts (GET handler)
  query.ts       Filters, rows, summary, options, digest-day fetch
  csv.ts         CSV string builder
  csv-export.ts  Streaming CSV response
  excel-export.ts  Workbook for digest (overview + per-branch sheets)
  enrich-item-codes.ts  CRM item-code backfill for export rows
types.ts         Row/summary/filter types
franchisee-label.ts  Display label helper
index.ts         Digest exports only (client-safe for mis-email CLI)
```

---

## Core flows

1. Open `/report/cancelled-calls` — default range = current calendar month (IST).
2. `mode=options` loads distinct filter values for the date window.
3. `mode=summary` returns KPI cards; `mode=rows` returns paginated register rows.
4. `format=csv` streams full result set (same filters, no pagination).
5. Digest (VPS cron): `istYesterdayYmd()` → `fetchCancelledCallsForDigestDay` → branch-grouped Excel → SMTP per recipient.

---

## Invariants (easy to break)

1. **Postgres only** — queries use `withAppClient`; no live CRM register path.
2. **Office scope** — non-HOD users restricted via `shouldRestrictToAssignedOffices` (same pattern as other reports).
3. **Default dates** — month-to-date in `Asia/Kolkata`; digest uses **yesterday IST** (`istYesterdayYmd`).
4. **Filter parity** — CSV, summary, rows, and digest must share `parseCancelledCallsFilters` / query WHERE clauses.
5. **Athena alias** — users with `page_athena_reconciliation` can open this page without `page_cancelled_calls` (`rbac-catalog`).

---

## Where to look

| Need | Place |
|------|--------|
| Page UI | `pages/CancelledCallsPageClient.tsx` |
| SQL / filters | `server/query.ts` |
| CSV export | `server/csv-export.ts` |
| Digest workbook | `server/excel-export.ts` |
| API | `server/routes/cancelled-calls.ts` |
| Sync worker | `@/lib/read-model/cancelled-call-register/run.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Column / filter fields | `types.ts`, page UI, CSV, excel-export, digest compose |
| Date defaults | Page client, `query.ts`, digest `istYesterdayYmd` |
| Office security | `query.ts`, rbac, other scoped reports |
| Hot sync / table shape | `@/lib/read-model/cancelled-call-register/*` |
| Digest recipients / schedule | `@/modules/mis-email` cancelled-call digest routes + sync |
