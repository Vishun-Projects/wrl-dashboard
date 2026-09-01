# Codebase structure

Snapshot of the repo layout after **module-first** migration  
**(re-scanned 2026-07-31).**

Runtime app lives under `src/`. Non-runtime archives sit in `dump/` (gitignored).  
**Module-first:** all product domains live in `src/modules/<name>/`. `src/features/` is empty. Platform infra stays in `src/lib/` until a later bulk rename to `src/shared/`. `src/app/` is a URL → module mapper only.

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
├── app/                 # Next.js routes only (thin URL → module mapper)
├── modules/             # Product domains (module-first)
├── sql/                 # Central SQL builders / query leaves (by domain)
├── features/            # Empty (legacy placeholder; do not add code)
├── components/          # Cross-page chrome / UI kit (temporary until shared/ui)
├── lib/                 # Platform infra (auth, db, supabase, read-model shell, …)
├── shared/              # Placeholder — bulk lib → shared rename deferred
└── hooks/               # Cross-cutting React hooks (e.g. usePageAlert)
```

Report filters context: `modules/mis/components/ReportFiltersContext.tsx`. Theme tokens live in `app/globals.css` `@theme` (no `src/styles/`).

### Import conventions

| From | Import |
|------|--------|
| App / other domains (client-safe) | `@/modules/<name>` (`index.ts` where present) |
| Same module internals | deep `@/modules/<name>/…` |
| SQL builders | `@/sql/<domain>/…` |
| MIS download helpers | `@/modules/mis/download` |
| MIS client-import server | `@/modules/mis/client-import/server` |
| Infra | `@/lib/...` |

Gate: `npm run check:feature-boundaries` (also in CI + husky pre-commit).

- **Hard:** retired `@/features/<old-domain>` paths; retired `@/lib/arcp`, `@/lib/read-model/arcp`, `@/lib/performance`, `@/lib/call-{display,register,row,status}` (use `@/lib/call/…`); `src/lib` → `@/features`; `shared` → features/modules.
- **Hard (STRICT):** deep cross-module imports into non-UI segments.
- **Soft:** `components` → modules; `lib` → `@/modules` (orchestrators).
- **`src/shared/`** is empty of code; platform stays in `src/lib/*` until rename.
- **`src/app/api`:** thin re-exports only — handler bodies live in `modules/*/server/routes`.

---

## `src/modules/` — product domains

```text
src/modules/<name>/
├── pages/            # Page-level UI
├── components/       # React UI pieces
├── services/         # Domain logic (when present)
├── server/           # Loaders + API route bodies
│   ├── routes/       # Bodies re-exported by src/app/api/…
│   └── sync/         # Optional worker/sync leaves
├── hooks/ | lib/ | constants/ | register/ | client-import/  # as needed
└── index.ts          # Public barrel when useful
```

| Module | Role |
|--------|------|
| `mis` | MIS Reports + register + client import |
| `arcp-claims` | ARCP claims UI + load + hot sync |
| `distribution` | Call distribution |
| `serial-audit` | Serial wise history |
| `location-audit` | Location audit |
| `warranty-master` | Warranty master |
| `mis-email` | MIS email + major repair alerts |
| `users` | User management |
| `roles` | Roles & access |
| `performance` | Performance insights |
| `security-audit` | Security audit UI |
| `cancelled-calls` | Cancelled call register |
| `athena-reconciliation` | Athena failed-calls report (query/CSV in `server/`; CRM ingest in `lib/read-model/athena-reconciliation`) |
| `auth` | Sign-in / sign-out / me / password-reset API |
| `calls` | Call-by-id / comments / flags / offices API |
| `sync` | Read-model status + VPS cron API |

---

## `src/features/`

Empty placeholder — see `src/features/README.md`. Do not add domain code here.

---

## `src/app/` — routes

```text
src/app/
├── login / forgot-password / reset-password / profile
├── admin/                   # Thin pages → @/modules/{users,roles,performance,security-audit,mis-email,…}
├── calls/
├── report/                  # Thin pages → @/modules/{mis,arcp-claims,distribution,…}
└── api/                     # Thin re-exports → @/modules/*/server/routes
```

Pages stay thin; domain work is imported from `@/modules/...`.

---

## `src/lib/` — shared infrastructure

```text
src/lib/
├── auth/            # Session, RBAC, avatar URLs, password mail
├── supabase/        # Browser/server clients; admin is server-only
├── db/              # Prisma + CRM postQuery proxy
├── read-model/      # Hot-table sync worker shell (CLI/nightly; domain sync in modules/*/server/sync)
├── call/            # Nested call helpers (display/register/row/status)
├── dates/ aging/ summary/ mail/ serial/ crm/ geo/ net/ security/ ui/ utils/ …
└── api/schemas/     # Shared API zod (where present)
```

**SQL builders** live in [`src/sql/`](../src/sql/) (not under `lib/`). See [`src/sql/README.md`](../src/sql/README.md).

**API rule:** Next discovers routes only under `src/app/api/**/route.ts`. Those files are one-line re-exports. All handler logic lives in `src/modules/<name>/server/routes/`.

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

(`settings/` holds cross-cutting chrome like `ThemePicker`; domain settings UI such as MIS email composer lives under `modules/mis-email/components/`.)

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
├── WesternCRM Schema Architect.txt   # Legacy CRM schema notes
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
| MIS report tabs / filters UI | `src/modules/mis/` |
| Call register | `src/modules/mis/register/` |
| Client Excel/CSV import | `src/modules/mis/client-import/` |
| ARCP claims | `src/modules/arcp-claims/` |
| Call distribution | `src/modules/distribution/` |
| Serial wise history | `src/modules/serial-audit/` |
| Location audit | `src/modules/location-audit/` |
| Warranty master | `src/modules/warranty-master/` |
| Mail & alerts | `src/modules/mis-email/` |
| Users / roles | `src/modules/users/`, `src/modules/roles/` |
| Performance insights | `src/modules/performance/` |
| Security audit | `src/modules/security-audit/` |
| Nightly hot sync | `src/lib/read-model/` (+ `modules/*/server/sync/`) |
| Auth / RBAC | `src/lib/auth/`, `src/lib/supabase/` |
| Route URL / API surface | `src/app/...` (thin) |
| VPS deploy / workers | `scripts/vps-hosting/` |
| Schema migrations (read model) | `docs/read-model-phase1-schema/` |
