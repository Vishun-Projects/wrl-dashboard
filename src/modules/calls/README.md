# Calls module

## Why this exists

Reports (Register, Distribution, Serial, Location Audit, …) all need the **same** “open this one call” experience: header, visits, faults, parts, portal comments, and portal flags. Without a shared module, every report would re-implement CRM fetch + office checks + merge quirks.

This module owns that **API surface**. The drawer UI lives in `src/components/calls` so any page can open a call without importing a report module.

```text
Report row click / TrnLink
        ↓
CallDetailDialogProvider (src/components/calls)
        ↓
GET /api/calls/[id]     ← call-by-id (CRM)
GET/POST comments|flags ← Postgres portal tables
GET /api/offices        ← filter dropdowns
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Call drawer UI | `src/components/calls/*` |
| Register list / hot table | `src/modules/mis` + `@/sql/read-model` |
| Portal filter SQL (`verified`→`noted`, …) | `@/sql/register/portal-filter-sql.ts` |
| Auth session / RBAC catalog | `@/lib/auth/*` |
| Mutation zod shapes | `@/lib/api/schemas/mutations.ts` |

## Layout

```text
server/routes/
  call-by-id.ts   Full CRM call graph for the drawer
  comments.ts     Portal notes on a call (Postgres)
  flags.ts        Portal triage flags (Postgres)
  offices.ts      Office dimension for filters/admin
```

Thin URL stubs: `src/app/api/calls/*`, `src/app/api/offices` → these files.

---

## call-by-id — core flow

**Job:** Given a route `id` (and optional `vtrnno` / `officeId`), return one call payload: parent row + history chain + visits + faults + parts (with barcode/serial merge).

**Auth:** Register tab access (`mis_reports` / `register`) + `canAccessOffice` on the parent’s `nofficeid`.

**Invariants (easy to break):**

1. **Prefer numeric `ncode` when the client has it.** Resolving by TRN alone can attach the wrong leg of a transfer chain.
2. **History ≠ child rows.** Transfer-history ncodes are for the history tab only. Visits / faults / parts must use the **parent** `ncode` (+ office). Mixing them pulled sibling calls’ children (past bug).
3. **Barcodes are often empty in CRM.** Parts may get serials from a last-resort parse of visit remarks — do not “clean that up” without checking real CRM data.

CRM: live `postQuery` against `trhcalls` (+ joins). Not the hot table — drawer needs the full child graph.

---

## comments — portal notes

**Job:** Human notes on a call that CRM does not own. Stored in Postgres `call_comments`.

**Why separate from CRM:** Ops triage (verified/hold/reject workflows) needs annotations that survive CRM view limits and stay office-scoped.

**Auth / scope:** Register RBAC. Non-national users only see/write comments for offices they can access. Same-origin on mutating requests.

**Side effect:** Clears portal audit server cache so Register “comments” filters refresh.

---

## flags — portal triage

**Job:** One active flag per call (`noted` / `escalate` / `query` — UI labels verified / rejected / hold). Table `call_flags` + `flag_audit_log`.

**Why:** Register and digests filter on these (`portal-filter-sql`). Flags are portal-only; they must not be confused with CRM cancel/status fields.

**Auth:** Bearer + Register RBAC + `canAccessOffice(office_id)` on the payload.

---

## offices — dimension list

**Job:** `mstoffice` rows for branch/franchisee pickers (Register filters, user admin, etc.).

**Why cached:** Full CRM `mstoffice` scans are slow; process-local ~30 min cache when not reading dims from Postgres.

**Critical semantics:**

```text
empty office_ids  →  see ALL offices  (same as HOD)
non-empty         →  ncode OR nunder in assigned set (franchisee under branch)
```

Treating empty as “no offices” locks the user out of every office-scoped API. Same rule as `@/sql/trhcalls/office-security` (`seesAllOffices`).

Postgres path: `queryOfficesFromPostgres` when `READ_*` dims flag says so; otherwise CRM + cache.

---

## UI entry points

| Piece | Role |
|-------|------|
| `CallDetailDialogProvider` | Global dialog host; pages wrap with this |
| `CallDetail` | Renders API payload (visits/parts/comments/flags) |
| `TrnLink` | Clickable TRN → opens drawer |
| `PartBarcodeImages` | Part photo helpers |

---

## When you change something

| Change | Also check |
|--------|------------|
| Flag type rename | `portal-filter-sql`, Register filters, mail digests |
| call-by-id child fetch | History vs parent ncode split |
| Office empty-list meaning | Every `seesAllOffices` / `assignedOffices.length === 0` caller |
| Comment/flag shape | `@/lib/api/schemas/mutations.ts` + Register cache clear |
