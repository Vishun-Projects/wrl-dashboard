# Location Audit module

## Why this exists

Spot **Tech. Solve** calls where the install-address pincode disagrees with the pincode implied by stored CRM GPS — primary fraud/quality signal for “solved at wrong place.” Detail can also compare visit GPS. Distance thresholds are **secondary**; do not revive the old 1km-as-primary aliases.

```text
/report/location-audit  →  LocationAuditPageClient
        ↓
GET …?mode=list|full|summary  (CRM Tech.Solve corpus + analyze)
        ↓
Pincode mismatch rows (severity flag/review/incomplete)
        ↓
mode=row → visit GPS + compare map; optional CSV
```

API meta advertises `auditMode: 'pincode_mismatch'`.

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Corpus SQL (Tech. Solve WHERE) | `@/sql/location-audit/queries.ts` |
| Pin / proximity / lat-lng parse | `@/lib/geo/*` |
| Office / HOD scope | `@/lib/auth/report-security` |
| Default call type | `@/modules/mis` (`SUMMARY_DEFAULT_CALL_TYPE`) |
| Thin stubs | `src/app/report/location-audit`, `src/app/api/report/location-audit*` |

## Layout

```text
pages/        LocationAuditPageClient
components/   Row detail, compare map
services/     Types, list filters, CSV export
server/       analyze.ts, handler.ts, routes/
index.ts      Public barrel
```

---

## Core flows

1. Open `/report/location-audit` with date range (+ filters).
2. List/full/summary modes fetch CRM Tech. Solve rows and run analyze tiers.
3. Rows classified by pincode match / severity.
4. Row detail loads visit GPS compare + map.
5. Optional gzipped CSV export.

---

## Invariants (easy to break)

1. Corpus = **Tech. Solve only**: `bfastclose=1`, `bsolved=0`, not cancelled. Closed/`bsolved` are out of scope (`TECH_SOLVED_WHERE`).
2. Primary fraud signal = **`pincode_mismatch`**; distance is soft/secondary.
3. Pincodes treated **same** if within `PINCODE_FRAUD_MAX_PROXIMITY_KM` (**~8 km**) even when nearest-area pins differ.
4. Visit soft thresholds: **500 m** vs stored GPS, **1000 m** vs install — secondary to pincode.
5. `clampLocationAuditLimit` — never let `TOP NaN` / non-finite reach SQL (max **2000**).
6. List severity: pincode mismatch → `flag`; incomplete GPS/address → `incomplete`.

---

## Where to look

| Need | Place |
|------|--------|
| List UI | `pages/LocationAuditPageClient.tsx` |
| Pincode / severity | `server/analyze.ts` |
| CRM fetch / export | `server/handler.ts` |
| API modes | `server/routes/location-audit.ts` |
| Detail + map | `components/LocationAuditRowDetail.tsx`, `LocationAuditCompareMap.tsx` |
| Tech. Solve SQL | `@/sql/location-audit/queries.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Tech. Solve predicate | `TECH_SOLVED_WHERE` + API meta `scope` |
| Proximity / radius | geo constants + `analyze.ts` visit thresholds together |
| Fraud signal / severity names | `services/types.ts`, analyze, UI, CSV, API meta |
| GPS field parsing | `@/lib/geo/parse-latlong` + analyze stored/visit paths |
| Auth page id | `location_audit` in rbac + `resolveReportSecurity` |
