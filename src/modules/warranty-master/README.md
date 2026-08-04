# Warranty Master module

## Why this exists

Warranty Master — inventory of **non-returned** machines with a real customer/party, filterable by profile/group/FG/dates, with FG-level detail and export. Live CRM only (no hot-table path).

```text
/report/warranty-master  →  WarrantyMasterPageClient
        ↓
GET ?mode=meta + mode=fgLines  (full FG corpus into client)
        ↓
Client filter / sort / aggregate → summary table
        ↓
Expand row → FG detail; optional CSV
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| WHERE / date expressions | `@/sql/warranty-master/*` (imports **module** constants — unusual reverse dependency) |
| CRM proxy | `@/lib/db/proxy` |
| Auth | `resolveRequestReportSecurity` (`pageId: 'warranty_master'`) |
| Thin stubs | `src/app/report/warranty-master`, `src/app/api/report/warranty-master` |

## Layout

```text
pages/        WarrantyMasterPageClient
components/   Toolbar, tables, summary, FG detail
services/     constants (SQL fragments), filter/normalize/sort/export
server/       fetch.ts + routes/warranty-master.ts
index.ts      Public barrel
```

---

## Core flows

1. Open `/report/warranty-master`.
2. Fetch `mode=meta` + `mode=fgLines` → CRM corpus into client cache.
3. Client filters/sorts/aggregates FG lines → summary.
4. Expand row → FG detail from in-memory index (or `mode=detail`).
5. Optional CSV (`format=csv`).

---

## Invariants (easy to break)

1. Corpus always **not returned** (`breturned` false/0/null) — `WARRANTY_MASTER_NOT_RETURNED_SQL`.
2. Must have **party profile code** (`npartyprofile` non-empty).
3. Must have **resolved party name** — do **not** fall back to profile code (`WARRANTY_MASTER_HAS_PARTY_NAME_SQL`).
4. `activeOnly` ⇒ warranty end ≥ today (`GETDATE()`); date bounds use inclusive from / exclusive end+1 day.
5. Client loads full FG lines once then shapes in browser; meta count drives cache invalidation.
6. Changing constants in `services/constants.ts` changes SQL — `@/sql/warranty-master/where-clause.ts` imports them.

---

## Where to look

| Need | Place |
|------|--------|
| UI + client corpus | `pages/WarrantyMasterPageClient.tsx` |
| Shared SQL fragments | `services/constants.ts` |
| Client shaping | `services/filter.ts`, `normalize.ts`, `sort.ts` |
| CRM + modes | `server/fetch.ts`, `server/routes/warranty-master.ts` |
| WHERE builders | `@/sql/warranty-master/where-clause.ts`, `queries.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Not-returned / party rules | `services/constants.ts` **and** `@/sql/warranty-master/where-clause.ts` |
| Date expressions | `sql/warranty-master/expressions.ts` + where-clause + tests |
| FG/customer filter params | `services/types.ts`, params parsers, SQL, toolbar |
| Aggregate grain | normalize/filter/sort + page expand index + CSV |
| Auth / path | `page_warranty_master`, `/report/warranty-master`, API stub |
