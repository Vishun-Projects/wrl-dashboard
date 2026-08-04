# Distribution module (Call Distribution)

## Why this exists

Branch-level capacity audit: which ASPs/technicians are overloaded vs idle (assigned with no completions, or on roster with zero allocations). Tables and KPIs only — the Leaflet map path was removed as unused.

```text
/report/distribution  →  DistributionPageClient
        ↓
GET /api/report/distribution/summary  (Postgres compact calls)
        ↓
Franchisee capacity KPIs + idle assignee rows (roster ∩ calls)
        ↓
Optional CSV export
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Compact call SQL | `@/sql/read-model/register` |
| Branch-name heuristics | `@/sql/trhcalls/query` (`looksLikeBranchOffice`) |
| Shared filters / status buckets | `@/modules/mis` |
| Engineer roster API | `/api/report/engineers` (MIS route) |
| Auth page id | `call_distribution` via report security |
| Thin stubs | `src/app/report/(filters)/distribution`, `src/app/api/report/distribution/summary` |

**URL is `/report/distribution`**, not `/report/call-distribution`.

## Layout

```text
pages/        DistributionPageClient
components/   Active filters, table panel, badges
services/     Idle rules, roster cache, CSV export
server/routes/  summary
index.ts      Public barrel
```

---

## Core flows

1. Open `/report/distribution` with shared MIS filters.
2. Summary API returns compact Postgres calls (**CRM-only mode is rejected**).
3. Client builds franchisee capacity KPIs from filtered calls.
4. Load engineer roster for selected branch → `buildIdleAssigneeRows`.
5. Optional idle / capacity CSV export.

---

## Invariants (easy to break)

1. API requires **Postgres read-model** (`readRegisterFromPostgres()` or 400).
2. Idle **`assigned_no_completions`**: `assigned > 0 && worked === 0`.
3. **Worked** = register buckets `closed` \| `techSolved` only (`isWorkedBucket` — must stay aligned with MIS `classifyRegisterRowStatus`).
4. **`zero_allocations`**: on branch roster but no calls in the period.
5. Branch label = WRL branch office name, or parent via `nunder` when the office is ASP/franchisee.

---

## Where to look

| Need | Place |
|------|--------|
| KPIs + tables | `pages/DistributionPageClient.tsx` |
| Idle rules | `services/idle-assignees.ts` |
| Roster cache | `services/engineer-roster-cache.ts` |
| CSV | `services/export-csv.ts` |
| API | `server/routes/summary.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| “Worked” definition | `isWorkedBucket` **and** MIS `classifyRegisterRowStatus` |
| Idle issue types | `idle-assignees.ts`, page KPIs/labels, CSV |
| Page path / permission | `rbac-catalog`, app route, API `pageId` |
| Compact columns | distribution SQL + client field reads |
| Roster shape | engineers API + roster cache + zero-allocation path |
