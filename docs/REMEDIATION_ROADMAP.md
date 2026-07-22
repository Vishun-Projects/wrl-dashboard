# Remediation Roadmap

Living checklist for structure + audit safety work.  
**Do not** treat the Jun 2026 [`CODEBASE_AUDIT.md`](./CODEBASE_AUDIT.md) orphan cleanup as current architecture guidance — see Phase 9 verdict below.

**Updated:** 2026-07-22

---

## Principles

1. **Impact before edit** — `rg` every importer; list API / sync / VPS / email dependents; list tests; log the row below *before* changing files.
2. **No half-moves** — a domain slice finishes in one PR: all files moved, all imports updated, old path gone (or shim deleted in that PR).
3. **One slice in flight** — never two domains half-moved; staging OK before merge.
4. **Ponytail** — moves + import fixups; no new deps for structure; ponytail-review the diff (delete/shrink/yagni).
5. **One runnable check** per non-trivial logic change.

---

## Target tree

```text
src/features/<domain>/
  ui/           # client components
  server/       # route-handler bodies / domain DB (when owned here)
  lib/          # domain helpers
  hooks/        # optional
  index.ts      # public API (other features import this only)

src/shared/     # auth primitives, db pool, ui kit, domain leaf helpers, net/
src/app/        # thin Next routes → @/features/...
```

**Import rule:** `features/A` → `shared` + other features’ `index.ts` only.  
`shared/read-model` must **not** import `features/report`.

Enforced by `npm run check:feature-boundaries`:

- Hard: retired `@/lib/<domain>` paths; `shared` → features; **`src/lib` → features** (allowlist empty — CI runs `BOUNDARY_LIB_FEATURES=strict`).
- Hard (STRICT): deep feature→feature imports (`FEATURE_BOUNDARIES_STRICT=0` to warn only).
- Soft: `components` → features (prefer barrels).


### Migrate order

| # | Domain | Status |
|---|--------|--------|
| 1 | `mis-email` (dry-run) | ☑ lib/ui + `MisEmailRoutingPageClient` under `features/mis-email/ui/` |
| 2 | `serial-audit` | ☑ lib/ui + `SerialAuditPageClient` under `features/serial-audit/ui/` |
| 3 | Characterization tests (report gate) | ☑ `report-characterization.test.ts` (logic-only; no `.test.tsx`) |
| 4 | `report` (split god UI) | ☑ moved + tab panels; orchestrator still large (~4.5k) |
| 5 | `register` | ☑ under features |
| 6 | `arcp` | ☑ lib/ui + `ArcpClaimsPageClient` under `features/arcp/ui/` |
| 7 | `mis-import` (+ SheetJS review) | ☑ + CDN 0.20.3; client/server barrels split |
| 8 | Remaining (`location-audit`, `warranty-master`, `distribution`) | ☑ lib/ui + `DistributionPageClient` under `features/distribution/ui/` |

---

## Impact protocol

Before changing file `X`:

1. `rg` importers of `X` and renamed symbols  
2. List runtime dependents (API, sync worker, VPS upload, email jobs)  
3. List tests that import those paths  
4. Fill a **Change log** row (below) with the impact list  
5. Edit + update **all** callers in this PR  
6. Run targeted vitest + `npm run typecheck`  
7. Ponytail-review notes in the change-log row  

---

## RLS board (Critical)

**Trust boundary:** Hot tables (`calls_latest_hot`, `arcp_lines_hot`, metrics/dims/MIS sync tables) are queried via **server `pg` / Prisma raw SQL** only. Browser Supabase client is auth/session — **no** `supabase.from('calls_latest_hot')` (verified 2026-07-22).

| Step | Action | Status |
|------|--------|--------|
| B0 | Document server-SQL-only (this section) | ☑ |
| B1 | `REVOKE ALL` on hot tables from `anon`, `authenticated` (SQL chunk [`21-revoke-hot-anon.sql`](./read-model-phase1-schema/21-revoke-hot-anon.sql)) | ☑ **Applied** 2026-07-22 via `npm run db:apply-read-model` (full schema + revoke on `DATABASE_URL`) |
| B2 | Full `ENABLE ROW LEVEL SECURITY` + policies **or** accept revoke-only in writing before any FSM/mobile PostgREST path | ☑ **Accepted revoke-only** until FSM/mobile PostgREST is planned — revoke is the control; revisit B2 policies when a client needs direct hot-table access |

---

## Safety board

| ID | Fix | Status |
|----|-----|--------|
| S1 | ARCP API: `withClient` → `withAppClient` (pooler) | ☑ `features/arcp/lib/server/{postgres,load-job,crm-labels}` |
| S2 | Avatar GET: require auth | ☑ `requireRequestUser` + `Cache-Control: private` |
| S3 | `supabaseAdmin`: `server-only`; stop public barrel export | ☑ |
| S4 | Call-register page: server gate (`canAccessMisTab` deployment_completion) | ☑ |

---

## PR / staging rule

- One domain slice = **one PR**; revert point = previous `main`.  
- Validate on **VPS staging** before merge to production.  
- Change log requires `staging: OK` (or `staging: deferred — code ready` if staging unavailable in-session).  
- Never start the next slice until the previous is merged or fully reverted.

### Land order (from `origin/main` — do not merge the batched local tree as one PR)

| PR | Branch suggestion | Contents | Staging gate |
|----|-------------------|----------|--------------|
| 0 | `remediation/docs-safety-rls` | Roadmap + audit pointer + S1–S4 + `21-revoke-hot-anon.sql` (SQL already applied on DB) | smoke login + avatar |
| 1 | `remediation/mis-email` | `features/mis-email` only | mis-email digest dry-run on VPS |
| 2 | `remediation/serial-audit` | `features/serial-audit` | serial-audit page |
| 3 | `remediation/report-characterization` | characterization + helpers tests only | CI green |
| 4 | `remediation/report-feature` | `features/report` move + tab panels | MIS tabs register/summary/accounts |
| 5 | `remediation/register` | `features/register` | register + exports |
| 6 | `remediation/arcp` | `features/arcp` + pooler | ARCP load |
| 7 | `remediation/mis-import-xlsx` | `features/mis-import` + SheetJS 0.20.3 | upload on VPS |
| 8 | `remediation/remaining-domains` | location-audit, warranty-master, distribution + boundary scripts | each page smoke |

**Current state:** implementation is local/batched on `main` (ahead of origin). Split into the PR branches above before merge; VPS staging per PR still required for app slices.

---

## Characterization gate (before `report` split)

Tripwires for:

- Register load (params / mapping)  
- Filter → query / corpus key  
- Export kickoff contracts  

☑ Done — `src/features/report/lib/report-characterization.test.ts` (+ `report-page-helpers.test.ts`)

---

## SheetJS / xlsx (during `mis-import` slice)

npm `audit fix` does **not** clear SheetJS high findings (patched builds are not on public npm registry `xlsx`).

**Decision (2026-07-22):** pin dependency to official CDN build:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

Covers CVE-2023-30533 (≥0.19.3) and CVE-2024-22363 (≥0.20.2). Parse stays in MIS-import / scripts (server-side buffers). Revisit only if we need Pro builds or a smaller format-specific parser.

☑ Reviewed + pinned  

---

## Phase 9 audit verdict (2026-07-22)

Production-capable for current MIS/register/ARCP volume, with pooler-aware register/ARCP path, hot-table revoke applied, feature slices, and STRICT import boundaries. Still needs one-PR-per-slice VPS staging before merge, and more handler tests for FSM readiness.

---

## Change log

| Date | PR / wave | Slice | Callers updated | Tests | Staging | Ponytail notes |
|------|-----------|-------|-----------------|-------|---------|----------------|
| 2026-07-22 | local | docs + safety S1–S4 + RLS B1 SQL + B2 revoke-only acceptance | ARCP pooler, avatar, admin barrel, call-register gate | characterization + helpers | deferred — code ready | no new structure deps |
| 2026-07-22 | local | mis-email → features/ | import rewrite | mis-email suite (1 env DB flake) | deferred | dry-run pattern |
| 2026-07-22 | local | serial-audit → features/ | import rewrite | — | deferred | second proof |
| 2026-07-22 | local | report characterization | — | 5 tripwires | n/a | gate before split |
| 2026-07-22 | local | report → features/ + split helpers/overlays/register tab | all `@/lib/report` callers | characterization + helpers | deferred | summary/accounts still in orchestrator |
| 2026-07-22 | local | register + arcp → features/ | import rewrite | arcp route-auth tests | deferred | ARCP already on withAppClient |
| 2026-07-22 | local | mis-import + SheetJS 0.20.3 CDN | package.json + lock | upload-fast-path samples | deferred | not npm audit fix |
| 2026-07-22 | local | location-audit, warranty-master, distribution | app + API imports | — | deferred | remaining domains |
| 2026-07-22 | local | import boundaries STRICT | collapse + rebuild index scripts | characterization + helpers green | n/a | STRICT on by default in npm script |
| 2026-07-22 | local | report tab carve | summary/accounts/bd_mis panels | characterization + helpers | deferred | ReportPageClient ~4465 LOC |
| 2026-07-22 | local | boundary: scan all src; lib→features debt allowlist | CI runs check | boundary OK; new lib leak fails | n/a | closes silent lib→features hole |
| 2026-07-22 | local | invert lib→features leaves (register-sql, dates, call-status, aging, mail, summary, …) | debt file empty; CI `BOUNDARY_LIB_FEATURES=strict` | characterization + aging + wco | n/a | Critical register/trhcalls cleared |
| 2026-07-22 | local | move 4 page orchestrators into features/*/ui | thin app pages | boundary OK | deferred | arcp/serial/distribution/mis-email |
| 2026-07-22 | local | husky prepare + pre-commit `check:feature-boundaries` | package.json + `.husky/pre-commit` | boundary OK | n/a | minimal gate only |

---

## Definition of done (per domain)

- [x] Domain files under `src/features/<domain>/` — including page orchestrators for arcp / serial-audit / distribution / mis-email  
- [x] Cross-feature imports via barrels — feature→feature STRICT; **lib→features empty (strict in CI)**  
- [x] Old `src/lib/<domain>` / `src/components/<domain>` removed for moved domains  
- [x] Impact protocol + change-log rows  
- [x] Targeted vitest for report gate + helpers (no `.test.tsx`)  
- [ ] App-slice VPS staging OK  
- [x] RLS B1 applied on DB  
- [x] Pre-commit / husky (`prepare` + `check:feature-boundaries`)  
- [x] Ponytail-review: no monorepo tooling  

### Residual (honest not-done)

1. **`src/shared/` empty** — auth/db/read-model/security still live in `src/lib/` (folder rename deferred until leaves settle; leaf helpers now under `lib/register-sql`, `lib/dates`, `lib/mail`, …).  
2. **No `.test.tsx` / no ReportPageClient component test**; characterization is logic-only.  
3. Split batched local work into land-order PRs + VPS staging before merge.  
4. Further shrink `ReportPageClient` orchestration.  
