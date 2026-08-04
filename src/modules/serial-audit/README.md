# Serial Audit module (Serial Wise History)

## Why this exists

Find serials with repeated complaints / major-repair patterns in a date window, then drill into per-serial call history and analysis for audit/export. Register cannot do this well — it is call-centric; this view is **serial-centric**.

```text
/report/serial-audit  →  SerialAuditPageClient
        ↓
GET /api/report/serial-audit  (flagged serial list)
        ↓
Select serial → detail / batch CRM fetch
        ↓
complaint-audit rules + analysis panel + CSV
```

**Page URL is `/report/serial-audit`** (not `serial-history`).

## What is *not* here

| Concern | Lives in |
|---------|----------|
| List/detail SQL builders | `@/sql/trhcalls/query.ts` (serial-audit*) |
| Office expand / intersect | `@/sql/serial-audit/sql-scope.ts` |
| Repair filter options | `@/sql/repair/*` |
| Serial normalize | `@/lib/serial/normalize` |
| Filters / status buckets | `@/modules/mis` |
| Thin stubs | `src/app/report/serial-audit`, `src/app/api/report/serial-audit/*` |

## Layout

```text
pages/        SerialAuditPageClient
components/   Analysis panel, calls table, legend
services/     Complaint audit rules, CSV export
server/       Batch CRM fetch, list/detail orchestration
  routes/     serial-audit APIs
index.ts      Public barrel
```

---

## Core flows

1. Open `/report/serial-audit` → dates / repair / branch / office scope.
2. List API returns flagged serials (CRM SQL + expanded office scope).
3. Select serial → detail/batch routes load call history (`batch-fetch`).
4. Client applies complaint-audit rules, include-cancelled toggle, min-repeats.
5. Analysis panel + CSV (export capped).

---

## Invariants (easy to break)

1. **`MIN_REPEAT_COMPLAINTS = 2`** — floor for “repeat”; UI/API must not go below.
2. Default list **excludes cancelled**; include-cancelled is a view toggle (often no refetch).
3. Risk flag = same complaint recurring on **non-cancelled** calls; cancel-and-re-raise churn is excluded (`evaluateSerialRiskFlag`).
4. Branch + assigned offices expand via `mstoffice` (`ncode|nunder`); **intersect** when both set; empty intersect → `['-1']` (no rows) — see `sql-scope.ts`.
5. Status summaries must stay aligned with list SQL / `aggregateComplaintsBySerial`.
6. Export capped (`SERIAL_AUDIT_EXPORT_MAX`); sequential batch fetch avoids CRM timeouts — don’t fan out blindly.

---

## Where to look

| Need | Place |
|------|--------|
| List / detail UI | `pages/SerialAuditPageClient.tsx` |
| Repeat / risk rules | `services/complaint-audit.ts` |
| List/detail API | `server/routes/serial-audit.ts` |
| Chunked CRM fetch | `server/batch-fetch.ts` |
| Office expand | `@/sql/serial-audit/sql-scope.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Min-repeats / cancelled semantics | `complaint-audit.ts`, page, list SQL, tests |
| Office scope | `sql-scope.ts` + every route using `resolveSerialAuditSqlOpts` |
| Repair/complaint params | Routes, trhcalls builders, `@/sql/repair` |
| Status tones | MIS `classifyRegisterRowStatus` + serial summarize |
| Page path | rbac `/report/serial-audit`, app page, API stubs |
