# Codebase structure

Snapshot of the repo layout after feature-slice remediation and `dump/` cleanup  
**(re-scanned 2026-07-22).**

Runtime app lives under `src/`. Non-runtime archives sit in `dump/` (gitignored).  
Domain UI/logic prefers `src/features/<domain>/`; shared infra stays in `src/lib/`.

---

## Top level

```text
fast-close-app/
├── src/                      # Application (Next.js App Router)
├── scripts/                  # Ops, audits, VPS, CRM mirror, apply-schema
├── docs/                     # Living docs + versioned SQL schema chunks
├── dump/                     # Local non-runtime junk/archives (gitignored)
├── prisma/                   # Prisma schema + migrations
├── public/                   # Static assets
├── exports/                  # Empty writer target (generated CSVs → often dumped)
├── logs/                     # Empty writer target (sync/perf logs)
├── .github/workflows/ci.yml
├── package.json
├── next.config.ts
├── vitest.config.ts
├── eslint.config.mjs
├── tsconfig.json
├── prisma.config.ts
├── AGENTS.md / CLAUDE.md
└── README.md
```

Local-only (not for commit): `.env*`, `.next/`, `node_modules/`, `.cache/`, `.vercel/`, `dump/`.

---

## `src/` — application

```text
src/
├── app/                 # Next.js routes (thin pages + API route handlers)
├── features/            # Vertical domain slices (preferred home for domain code)
├── components/          # Cross-page UI shells (layout, calls, admin chrome, ui kit)
├── lib/                 # Shared infra: auth, db, supabase, read-model sync, net, … (real shared layer)
├── shared/              # Placeholder only (README) — bulk rename lib → shared deferred
└── hooks/               # Cross-cutting React hooks (e.g. usePageAlert)
```

Report filters context lives in-feature: `features/report/components/ReportFiltersContext.tsx`. Theme tokens live in `app/globals.css` `@theme` (no `src/styles/`).

### Import conventions

| From | Import |
|------|--------|
| App / other features (client-safe) | `@/features/<domain>` (`index.ts`) |
| MIS import server/pg helpers | `@/features/mis-import/server` |
| Report download helpers only | `@/features/report/download` |
| Same feature internals | `@/features/<domain>/components|services|server|hooks|lib/...` |
| Infra | `@/lib/...` |

Gate: `npm run check:feature-boundaries` (also in CI + husky pre-commit).

- **Hard:** `src/lib` → `@/features` — debt allowlist empty; CI sets `BOUNDARY_LIB_FEATURES=strict`.
- **Hard (STRICT):** deep feature→feature imports.
- **Soft:** `components` → features (prefer barrels).
- **`src/shared/`** is empty of code; leaf helpers inverted into neutral `src/lib/*` paths (`register-sql`, `dates`, `call-status`, `aging`, `mail`, `summary`, …). Bulk rename `lib` → `shared` still deferred.

---

## `src/features/` — domains

Each domain roughly:

```text
src/features/<domain>/
├── index.ts          # Public barrel (client-safe where split exists)
├── server.ts         # Optional server-only barrel (mis-import; avoids server/ folder clash)
├── download.ts       # Optional thin client entry (report)
├── components/       # React UI
├── services/         # Domain business logic
├── server/           # API/CRM/Postgres-only (when present)
├── hooks/            # React hooks (report)
└── lib/              # Tiny pure helpers only (report); prefer services/ elsewhere
```

**Placement rule:** React → `components/` or `hooks/`. Domain logic → `services/`. Next/Prisma/CRM/cookies → `server/` (or `server.ts` barrel). Pure no-I/O helpers → `lib/` only when tiny.

| Domain | Role | Notes |
|--------|------|--------|
| `report` | MIS report shell, filters, summary/accounts, corpus | `components/` + `services/` + `server/` + thin `lib/`; `download.ts` |
| `register` | Call register table/filters/export | `components/` + `services/` + `server/` |
| `arcp` | ARCP claims UI + server load | `components/` + `services/` + `server/` |
| `mis-email` | Digest compose/send | `components/` + `services/` |
| `serial-audit` | Serial / complaint audit | `components/` + `services/` + `server/` |
| `distribution` | Call distribution | `components/` + `services/` |
| `mis-import` | Client file import / upload | `services/`; `index.ts` client-safe; `server.ts` = pg |
| `location-audit` | Location audit | `components/` + `services/` + `server/` |
| `warranty-master` | Warranty master | `components/` + `services/` + `server/` |
| `major-repair-alerts` | Major repair alerts UI | `components/` only |

---

## `src/app/` — routes

```text
src/app/
├── login / forgot-password / reset-password / profile
├── admin/
│   ├── users / roles / sync
│   ├── mis-email-routing
│   └── performance-insights
├── calls/
├── report/
│   ├── (filters)/              # Shared report filter layout
│   │   ├── page.tsx            # Main MIS report
│   │   ├── arcp-claims/
│   │   ├── distribution/
│   │   ├── location-audit/
│   │   └── serial-audit/
│   ├── call-register/
│   └── warranty-master/
└── api/
    ├── auth/                   # sign-in, sign-out, me, forgot-password
    ├── admin/                  # users, roles, mis-email, performance, …
    ├── report/                 # register, summary, arcp, serial-audit, …
    ├── mis-client-import/      # upload, chunks, sources, batches, summary
    ├── profile/                # avatar, mis-email prefs, password
    ├── read-model/             # sync status / cron
    ├── sync/ + sync-proxy/     # legacy sync helpers
    ├── distribution / calls / comments / flags / offices
    └── cache/
```

Pages stay thin; domain work is imported from `@/features/...`.

---

## `src/lib/` — shared infrastructure

```text
src/lib/
├── auth/            # Session, RBAC, avatar URLs, password mail
├── supabase/        # Browser/server clients; admin is server-only
├── db/              # Prisma + CRM postQuery proxy
├── read-model/      # Hot-table sync worker (CLI, queries, ARCP, metrics)
├── sync/            # Sync-proxy route helpers (+ proxy-limit)
├── trhcalls/        # Call SQL helpers
├── register-sql/    # WCO / ARCP pick / register enrich leaves (shared with features)
├── dates/ call-display/ call-status/ aging/ summary/ mail/ serial/ call-register/
├── call-row/ crm/ geo/ http/ net/ security/ performance/ ui/ utils/ …
└── api/schemas/     # Shared API zod (where present)
```

---

## `src/components/` — chrome / kit

```text
src/components/
├── layout/          # Dashboard shell, nav
├── ui/              # Shared primitives (alerts, scroll, …)
├── calls/           # Call detail dialog, etc.
├── admin/ settings/ theme/ motion/ performance/ shared/
└── README.md
```

(`settings/` holds cross-cutting chrome like `ThemePicker`; domain settings UI such as MIS email composer lives under `features/mis-email/components/`.)

---

## `docs/`

```text
docs/
├── REMEDIATION_ROADMAP.md      # Living remediation + feature-layout board
├── CODEBASE_AUDIT.md           # Points at roadmap for architecture tracking
├── SUPABASE_SETUP.md / sync.md / crm-mirror-sync.md / ui-patterns.md / …
├── read-model-phase1-*.md      # Architecture / cutover / worker specs
├── read-model-phase1-schema/   # Versioned SQL 01…21 (incl. revoke-hot-anon)
├── old-crm-schema/
├── WesternCRM Schema Architect.txt   # Served by sync-proxy
├── WesternCRM_Schema_Blueprint.sql
└── app-users-*.sql / drop-report-preferences.sql / …
```

---

## `scripts/`

```text
scripts/
├── apply-read-model-schema.mjs          # Applies docs/read-model-phase1-schema/*.sql
├── check-feature-import-boundaries.mjs  # npm run check:feature-boundaries
├── vps-hosting/                         # Deploy, sync-worker, mis-email, upload, mail relay
├── mis-client/                          # MIS import investigation / seed helpers
├── crm_mirror/ + crm_mirror_sync.py
├── ci/
├── rbac/
└── check-*.ts / audit-*.ts / reconcile-*.ts   # One-off ops & data probes
```

---

## `dump/` (local only)

Not part of the running app. Current contents after discards:

```text
dump/
├── README.md
├── requirements-crm-mirror.txt
├── requirements-sync.txt
├── root/                       # zip, leftovers, …
├── scripts/                    # One-off remediation codemods
├── docs/                       # BRD/FSD binaries, git-audit, sample data
├── exports-data/
└── logs/
```

---

## Data / deploy sketch

```text
Browser (Next client)
    │  auth/session via Supabase JS
    ▼
Next.js (Vercel)  ──API──►  features/* server libs
    │                         │
    │                         ├── Prisma / Supabase Postgres (app DB, hot tables)
    │                         └── CRM SQL via postQuery proxy (where still used)
    ▼
VPS (optional)
    ├── sync-worker (read-model CLI daemon)
    ├── mis-upload-server (chunked MIS uploads)
    └── mis-email digest / mail relay
```

Hot tables are **server SQL only**; PostgREST roles revoked (`21-revoke-hot-anon.sql`).

---

## Quick “where do I change X?”

| Want to change… | Look in… |
|-----------------|----------|
| MIS report tabs / filters UI | `src/features/report/components/` |
| Register grid / export client | `src/features/register/` |
| ARCP claims | `src/features/arcp/` |
| Client Excel/CSV import | `src/features/mis-import/` (+ `server.ts` for DB) |
| Email digests | `src/features/mis-email/` |
| Nightly hot sync | `src/lib/read-model/` |
| Auth / RBAC | `src/lib/auth/`, `src/lib/supabase/` |
| Route URL / API surface | `src/app/...` |
| VPS deploy / workers | `scripts/vps-hosting/` |
| Schema migrations (read model) | `docs/read-model-phase1-schema/` |
