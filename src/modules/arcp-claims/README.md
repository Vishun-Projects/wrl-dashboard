# ARCP Claims module

## Why this exists

ARCP Claims report — load, filter, aggregate, detail export, and PDF. Owns the `arcp_lines_hot` sync path so claims stay fast on Postgres while CRM remains source of truth. Hybrid load fills coverage gaps from CRM when the hot table is incomplete.

```text
/report/arcp-claims  →  ArcpClaimsPageClient
        ↓
  load-start / load-status  (hybrid Postgres ↔ CRM)
        ↓
  aggregates + optional detail job (weekly chunks)
        ↓
  PDF / CSV export
```

Worker: `server/sync/*` (CLI / nightly) — not the browser.

## What is *not* here

| Concern | Lives in |
|---------|----------|
| SQL builders / hot queries | `@/sql/arcp-claims/*` |
| BM approve-date SQL | `@/sql/register/arcp-approve-dates*` |
| Office / HOD scope helpers | `@/lib/auth/report-security` (via `server/route-auth.ts`) |
| Read-from flags | `@/lib/read-model/flags` |
| Schema DDL | `docs/read-model-phase1-schema/` |
| Thin stubs | `src/app/report/arcp-claims`, `src/app/api/report/arcp-claims/*` |

## Layout

```text
pages/        ArcpClaimsPageClient
components/   Toolbar, tables, PDF viewer, banners
services/     Query/table/export/PDF (client-safe)
server/
  routes/     aggregates, detail, load-*, detail-export
  sync/       Hot backfill + incremental
constants/    Local/upcountry labels
index.ts      Public client-safe barrel
```

---

## Core flows

1. Open `/report/arcp-claims` → set date basis/filters.
2. `load-start` → hybrid aggregates (Postgres if covered, else CRM).
3. Poll `load-status`; optional detail job for line-level data (weekly chunks).
4. PDF via `services/pdf.ts`; detail CSV prefers one Postgres scan when available.
5. Sync worker keeps `arcp_lines_hot` warm (`server/sync/`).

---

## Invariants (easy to break)

1. Auth = **`page_arcp_claims`**; HOD sees all offices, BM scoped to `office_ids` (`route-auth.ts`).
2. Default date basis is **`bm_approved_at`** (`ARCP_DEFAULT_DATE_FILTER_COLUMN`).
3. Detail load chunk plan **must match** `startOrResumeLoadJob` / `planArcpLoadJobChunks(detail)` or progress stays at 0%.
4. Long detail jobs are **weekly** chunks — summary month chunks would never complete weekly job rows.
5. Backfill **never wipes** on normal restart — only explicit reset / `FORCE_RESET`.
6. On CRM timeout/OOM: split windows and retry — **never skip a day**. Export streams row-by-row; do not re-run weekly CRM chunks for Postgres export.

---

## Where to look

| Need | Place |
|------|--------|
| UI + load orchestration | `pages/ArcpClaimsPageClient.tsx` |
| Hybrid CRM ↔ hot | `server/hybrid-load.ts` |
| Auth / office scope | `server/route-auth.ts` |
| Sync worker | `server/sync/` |
| Query + hot table | `@/sql/arcp-claims/query.ts`, `postgres.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Date column / chunk size | `sql/arcp-claims/query.ts`, hybrid-load, load-job, fetch, client progress |
| Office scoping | `route-auth` + every fetch opts consumer |
| Hot columns | `sql/arcp-claims/postgres.ts`, sync upsert/transform, coverage, schema docs |
| Postgres vs CRM mode | `@/lib/read-model/flags`, `ARCP_CRM_FALLBACK_ON_EMPTY` |
