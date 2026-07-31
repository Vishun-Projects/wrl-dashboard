# ARCP module

Pilot for module-first layout. Everything ARCP-owned lives here; `src/app` only maps URLs.

```text
pages/        Page-level UI (ArcpClaimsPageClient)
components/   Toolbar, tables, PDF viewer, banners
services/     Client-safe domain logic (query, table, export, pdf)
server/       Claims loaders + route handlers
  routes/     Bodies for /api/report/arcp-claims/*
  sync/       Hot-table backfill / incremental (former lib/read-model/arcp)
constants/    e.g. local-upcountry ncode labels
index.ts      Public client-safe barrel
```

## Imports

| Need | Import |
|------|--------|
| Client-safe services | `@/modules/arcp` |
| Page UI | `@/modules/arcp/pages/ArcpClaimsPageClient` |
| Claims server | `@/modules/arcp/server` or `@/modules/arcp/server/...` |
| Sync worker | `@/modules/arcp/server/sync/...` |

URL paths stay `/report/arcp-claims` and `/api/report/arcp-claims/*` (thin re-exports under `src/app`).

Do not recreate empty `hooks/`, `schemas/`, `types/`, `repositories/`, or `sql/` until there are real files for them.
