# MIS Call Register (`mis/register`)

## Why this exists

**Call Register** tab UI and server export path: filtered hot/CRM register rows, column picker, status chips, branch/franchisee filters, stats bar, and Excel/CSV export. Shared filter widgets (`DateRangeSelector`, `RegisterMultiSelect`) are reused by sibling reports (e.g. cancelled-calls).

```text
/report (Register tab)  →  CallRegisterPageClient + register components
        ↓
GET /api/report/call-register/*  (via mis/server/routes + register/server)
        ↓
Postgres hot and/or CRM register SQL
        ↓
Excel/CSV export (postgres-csv-export, handler)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Summary / Accounts / BD-MIS tabs | `@/modules/mis` parent (`pages/ReportPageClient`, `services/`) |
| Register SQL builders | `@/sql/read-model/register`, `@/sql/register/*` |
| Shared register-view / status buckets | `@/modules/mis/services/register-view.ts`, `@/lib/call/*` |
| Portal flags / comments | `@/modules/calls` |
| Parent MIS filters context | `@/modules/mis/components/ReportFiltersContext.tsx` |

## Layout

```text
components/   Filter bar, column picker, status chips, date range, multi-select, stats
services/     table-columns, export-fetch, excel-export, register-export-format
server/       handler, postgres-request, csv/postgres csv export, repair-call-ncodes
index.ts      Client-safe services barrel (no React — keeps CLI/import paths light)
```

---

## Core flows

1. Register tab loads within shared MIS filter context (date, branch, franchisee, status, …).
2. Server handler resolves Postgres vs CRM path from env + request.
3. Client renders paginated/sorted table with column visibility from `table-columns.ts`.
4. Export fetches full register via `export-fetch` → Excel or streaming CSV.
5. Other modules deep-import `DateRangeSelector` / `RegisterMultiSelect` for consistent UX.

---

## Invariants (easy to break)

1. **Status chips** must stay aligned with MIS `classifyRegisterRowStatus` / distribution `isWorkedBucket`.
2. **Export auth** — `register-csv-export-auth.ts` must match API route security.
3. **`index.ts` stays React-free** — only services exports; UI is deep-imported.
4. **Column keys** — `table-columns.ts` drives picker, table cells, and export headers together.
5. **WCO / repair ncodes** — `repair-call-ncodes.ts` affects register row enrichment; test when CRM fields change.

---

## Where to look

| Need | Place |
|------|--------|
| Register tab page | `@/modules/mis/pages/CallRegisterPageClient.tsx` |
| Table columns | `services/table-columns.ts` |
| Export | `services/export-fetch.ts`, `server/postgres-csv-export.ts` |
| Shared filters | `components/DateRangeSelector.tsx`, `RegisterMultiSelect.tsx` |
| API wiring | `@/modules/mis/server/routes/*` + `register/server/handler.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Register column | `table-columns.ts`, `RegisterTableCells`, export format |
| Status bucket labels | MIS `register-view`, distribution idle rules |
| Export format | `register-export-format.ts`, characterization tests |
| Filter widget API | cancelled-calls and other consumers of register components |
