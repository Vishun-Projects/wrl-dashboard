# MIS module

## Why this exists

Primary ops reporting hub: Call Register, Summary, Accounts, BD-MIS, Deployment Completion, and client Excel/CSV import. Sibling reports (ARCP, distribution, serial, location, warranty) reuse MIS filters, corpus loading, and register-view helpers instead of reinventing them.

```text
/report  →  ReportPageClient + ReportFiltersProvider
               ↓
         corpus / summary / register APIs
               ↓
         tab panels (RBAC ∩ feature flags)
               ↓
         client-import batches (optional merge into BD-MIS / Accounts)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Hot / CRM SQL builders | `@/sql/read-model/*`, `@/sql/trhcalls/*`, `@/sql/register/*` |
| Aging / summary derive | `@/lib/aging`, `@/lib/summary/derive` |
| Geo helpers | `@/lib/geo/*` |
| Permission catalog / tabs | `@/lib/auth/rbac-catalog.ts` |
| Thin Next stubs | `src/app/report/*`, `src/app/api/report/*` |
| Sibling report UIs | Their own `src/modules/<name>` |

## Layout

```text
pages/           ReportPageClient, CallRegisterPageClient
components/      Filters, tab panels, loading, merge cells
hooks/           Report data hooks
services/        Summary / accounts / BD-MIS / merge / filters
register/        Call-register UI + server + services
client-import/   Upload → normalize → store batches
server/routes/   MIS /api/report/* + /api/mis-client-import/*
download.ts      Blob download helper
index.ts         Client-safe barrel (no React — email CLI imports this)
```

---

## Core flows

1. Open `/report` → shared filters + corpus load (Postgres hot and/or CRM).
2. Switch tabs under RBAC; BD-MIS merges CRM + client-import with Cadbury/Coke rules.
3. Call Register uses hot/CRM register paths + portal flags/comments.
4. Client import: upload chunks → normalize → batches used by Accounts/BD-MIS/mail.
5. Exports / digests must use the **same** open/solved/merge math as on-screen counts.

---

## Invariants (easy to break)

1. **BD-MIS Cadbury** = import-only (subtract CRM Cadbury/Mondelez, add client Cadbury). **Coke** = CRM + import (never subtract CRM Coke). See `services/bd-mis-summary.ts`, `account-merge.ts`.
2. **West zone** keeps CRM Cadbury; Mondelez import is N/E/S only.
3. **Tab access** = RBAC ∩ feature flag — `bd_mis_summary` hidden when flag off even if permitted (`mis-tab-access.ts`).
4. **`index.ts` must stay client-safe / non-React** so MIS email CLI does not pull the component tree.
5. **IndexedDB** `REPORTS_DB_VERSION` / shared-register cache versions must stay in sync everywhere the DB is opened.
6. **Count parity**: UI totals must match Excel/digest (`count-parity.test.ts`). Wide ranges clamp to `MAX_CLIENT_CORPUS_DAYS`; Serial Audit is the full-history escape hatch.

---

## Where to look

| Need | Place |
|------|--------|
| Tab shell | `pages/ReportPageClient.tsx` |
| Shared filters / corpus state | `components/ReportFiltersContext.tsx` |
| Cadbury / Coke / merge | `services/bd-mis-summary.ts`, `account-merge.ts` |
| Tab RBAC ∩ flags | `services/mis-tab-access.ts` |
| Call Register | `register/` |
| Client import | `client-import/` |
| API handlers | `server/routes/` |

## Imports

| Need | Import |
|------|--------|
| Client barrel | `@/modules/mis` |
| Filters (other reports) | `@/modules/mis/components/…`, `services/…` |
| Client import server | `@/modules/mis/client-import/server` |

## When you change something

| Change | Also check |
|--------|------------|
| Cadbury/Coke account keys | `account-merge`, `bd-mis-summary`, client-import normalize, Excel, mail-basis, parity tests |
| Open/solved definition | Summary, BD-MIS, Excel, digest, parity tests |
| New MIS tab | `rbac-catalog` + `mis-tab-access` + ReportPageClient panel |
| IndexedDB version | Every opener of `wrl_reports_db` + shared-register consumers |
| Filter / register-view helpers | distribution, serial-audit, other `@/modules/mis` consumers |
