> **Status:** Ready (repo-generated from `docs/CODEBASE_STRUCTURE.md`).

# Codebase structure

Snapshot of the repo layout after **module-first** migration  
**(re-scanned 2026-09-01 — all 18 product modules documented).**

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
| `cancelled-calls` | Cancelled call register (Postgres) + digest Excel export |
| `athena-reconciliation` | Athena failed-calls report (query/CSV in `server/`; CRM ingest in `lib/read-model/athena-reconciliation`) |
| `attendance` | Service call activity admin report (`manage_users`; SQL in `@/sql/attendance`) |
| `subcontractor-stock` | SAP vs CRM stock reconciliation + Mail & Alerts settings tab |
| `auth` | Sign-in / sign-out / me / password-reset API |
| `calls` | Call-by-id / comments / flags / offices API |
| `sync` | Read-model status + VPS cron API |

Each module has a **`README.md`** at `src/modules/<name>/README.md` (MIS sub-leaves: `mis/register/`, `mis/client-import/`). System-wide design: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

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
├── ARCHITECTURE.md             # System design — start here (module map, diagrams, RBAC)
├── CODEBASE_STRUCTURE.md       # This file — repo layout + module index
├── REMEDIATION_ROADMAP.md       # Living remediation + feature-layout board
├── SUPABASE_SETUP.md / sync.md / crm-mirror-sync.md / ui-patterns.md / …
├── diagrams/                   # 20 Mermaid + PNG pairs (source of truth: ARCHITECTURE.md §1–§11)
│   ├── 01-system-workflow.*
│   ├── 02-1 … 02-12 sequence flows (auth, MIS, email, ARCP, cancelled, Athena, …)
│   ├── 06-deployment-infrastructure.*
│   ├── 07-etl-data-flow.*
│   ├── 08-background-jobs-*. *
│   ├── 09-key-tables-erd.*
│   ├── 10-rbac-decision-flow.*
│   └── 11-failure-degradation-paths.*
│   Regenerate: `node scripts/ops/export-mermaid-diagrams.mjs`
├── read-model-phase1-*.md      # Read-model cutover / worker specs
├── read-model-phase1-schema/   # Versioned SQL chunks
├── old-crm-schema/
├── WesternCRM Schema Architect.txt   # Legacy CRM schema notes
├── WesternCRM_Schema_Blueprint.sql
└── app-users-*.sql / drop-report-preferences.sql / …
```

---

## `scripts/`

```text
scripts/
├── db/           # Schema apply helpers (`npm run db:apply-*`)
├── quality/      # `check:feature-boundaries`, performance-log analyze, push notify
├── ops/          # One-off probes, exports, mail-relay test
├── vps-hosting/  # Deploy, sync-worker, mis-email, upload, mail relay
├── mis-client/   # MIS import investigation / seed helpers
├── crm_mirror/ + crm_mirror_sync.py
├── ci/
└── rbac/
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
    └── mail-scheduler.sh (MIS digest + subcontractor) / mail relay
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
| Mail & alerts (send transport + digests) | `src/modules/mis-email/services/send.ts`, `src/modules/mis-email/` |
| Users / roles | `src/modules/users/`, `src/modules/roles/` |
| Performance insights | `src/modules/performance/` |
| Security audit | `src/modules/security-audit/` |
| Cancelled calls register | `src/modules/cancelled-calls/` |
| Athena failed-calls reconciliation | `src/modules/athena-reconciliation/` (+ `src/lib/read-model/athena-reconciliation/`) |
| Service call activity (admin) | `src/modules/attendance/`, `src/app/admin/attendance/` |
| Subcontractor stock reconciliation | `src/modules/subcontractor-stock/` (Mail & Alerts tab) |
| Nightly hot sync | `src/lib/read-model/` (+ `modules/*/server/sync/`) |
| Auth / RBAC | `src/lib/auth/`, `src/lib/supabase/` |
| Route URL / API surface | `src/app/...` (thin) |
| VPS deploy / workers | `scripts/vps-hosting/` |
| Schema migrations (read model) | `docs/read-model-phase1-schema/` |
