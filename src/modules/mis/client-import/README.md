# MIS Client Import (`mis/client-import`)

## Why this exists

**Client Excel/CSV upload** for Cadbury/Coke and related account merges: chunked upload → detect/parse → normalize → Postgres batch store. Batches feed MIS Accounts, BD-MIS merge math, and MIS email digest counts.

```text
/report (import UI)  →  client-import upload components
        ↓
POST /api/mis-client-import/*  (chunks, process, list batches)
        ↓
normalize → store batch rows (Postgres)
        ↓
BD-MIS / Accounts / mail-basis consume batches
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| BD-MIS Cadbury/Coke merge rules | `@/modules/mis/services/bd-mis-summary.ts`, `account-merge.ts` |
| Mail digest counts | `@/modules/mis-email/services/mail-basis.ts` |
| Upload route stubs | `src/app/api/mis-client-import/*` |
| Hot table / CRM sync | `@/lib/read-model/*` |
| VPS chunked upload server | `scripts/vps-hosting/` (optional direct upload path) |

## Layout

```text
services/   upload-client, parse-*, normalize, store, batch-file, aggregate, config, …
index.ts    Client-safe barrel (upload UI + types)
server.ts   Server-only barrel — import from '@/modules/mis/client-import/server'
```

---

## Core flows

1. User selects client source + file; upload may use chunked/resume path for large files.
2. `detect-parse` → `parse-csv` / `parse-xlsx` → `normalize` (branch map, Cadbury filters, dates).
3. `process-upload` persists batch + row stats to Postgres (`store.ts`).
4. MIS tabs load batch list and merge into summary/register views.
5. Retention purge (`purge-old-files`) drops stale blob chunks per config.

---

## Invariants (easy to break)

1. **Cadbury geography** — West keeps CRM Cadbury; Mondelez import is N/E/S only (`cadbury-filters.ts`, `region.ts`).
2. **Normalize keys** must match `account-merge` / `bd-mis-summary` account identifiers.
3. **`server.ts` is server-only** — never import from client components; use `index.ts` for browser code.
4. **Upload limits** — `upload-limits.ts` + chunk constants enforced on client and server.
5. **Count parity** — imported totals must match MIS on-screen and digest (`count-parity.test.ts` in parent mis).

---

## Where to look

| Need | Place |
|------|--------|
| Upload UI hooks | `services/upload-client.ts`, `upload-chunk-http.ts` |
| Parse pipeline | `services/detect-parse.ts`, `normalize.ts` |
| Batch persistence | `services/store.ts`, `batch-file.ts` |
| Server API bodies | `@/modules/mis/server/routes/mis-import-*` |
| Config / retention | `services/config.ts`, `purge-old-files.ts` |

## Imports

| Need | Import |
|------|--------|
| Client barrel | `@/modules/mis/client-import` |
| Server barrel | `@/modules/mis/client-import/server` |

## When you change something

| Change | Also check |
|--------|------------|
| Column mapping / normalize | `bd-mis-summary`, `account-merge`, parity tests |
| Cadbury client list | `cadbury-filters`, `client-branch-map`, West zone rule |
| Chunk upload protocol | chunk constants tests, VPS upload server |
| Batch schema | SQL migration, store, aggregate, MIS batch list UI |
