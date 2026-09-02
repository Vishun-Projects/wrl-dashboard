# Production read sources

> **Status:** Codebase audit 2026-09-01. VPS `.env` values must be confirmed on the host before Phase 4 CRM deletions.

## VPS env flags (confirm on server)

| Variable | Intended prod value | Controls |
|----------|---------------------|----------|
| `READ_SUMMARY_FROM` | `postgres` | MIS Summary tab |
| `READ_REGISTER_FROM` | `postgres` | Call Register + exports |
| `READ_DISTRIBUTION_FROM` | `postgres` | Call Distribution (required; CRM rejected) |
| `READ_DIMS_FROM` | `postgres` | Office/dimension lists |
| `READ_ARCP_FROM` | `postgres` | ARCP claims hot table |
| `ARCP_USE_LIVE_CRM` | unset or `false` | Forces hybrid CRM gap-fill when true |
| `READ_CALLS_FROM` | `postgres` (fallback) | Global override when per-report unset |

**Staleness:** `calls_latest_hot` lags CRM by up to ~3 min (sync daemon interval). Acceptable for reporting; not for real-time ops.

**Sign-off for Phase 4:** When all rows below show **Postgres** in prod and hot lag is acceptable, CRM fallback branches in MIS register/summary may be deleted.

---

## Report → data source

| Report / feature | Primary source | CRM still required? | Delete CRM branch? |
|------------------|----------------|---------------------|-------------------|
| MIS Summary | Postgres (`READ_SUMMARY_FROM`) | No when postgres | Yes, after sign-off |
| MIS Register | Postgres (`READ_REGISTER_FROM`) | No when postgres | Yes, after sign-off |
| MIS Accounts / BD-MIS | Postgres + client import | CRM for Cadbury subtract only | Partial — keep CRM trace paths until BD-MIS rules migrated |
| Call Distribution | Postgres only | No (400 if CRM) | Already postgres-only |
| ARCP Claims | `arcp_lines_hot` (+ hybrid CRM fill) | Yes until hot coverage complete | When `ARCP_USE_LIVE_CRM=false` stable |
| Cancelled Calls | `calls_cancelled` | Item-code enrich only | Keep enrich CRM call |
| Athena Reconciliation | `athena_failed_calls_*` | Sync ingest only | N/A (not register CRM path) |
| Serial / Location / Warranty | Live CRM `postQuery` | **Yes** | No |
| Attendance activity | `crm_attendance_details` | Sync ingest only | N/A |
| Call detail drawer | Live CRM | **Yes** | No |
| Comments / flags | Postgres portal tables | No | N/A |

---

## Local dev defaults

Without env overrides, [`src/lib/read-model/flags.ts`](../src/lib/read-model/flags.ts) defaults to **`crm`**. Local dev uses CRM unless `.env.local` sets `READ_*_FROM=postgres`.

Client mirrors: [`src/lib/read-model/client-flags.ts`](../src/lib/read-model/client-flags.ts) — collapse to server source in Phase 3.

---

## Sync ownership (target after Phase 4)

| Domain | Sync today | Target module |
|--------|------------|---------------|
| Calls hot | `lib/read-model/incremental.ts` | stays in lib (core) |
| Athena failures | `lib/read-model/athena-reconciliation/` | `modules/athena-reconciliation/server/sync/` |
| Cancelled register | `lib/read-model/cancelled-call-register/` | `modules/cancelled-calls/server/sync/` |
| Attendance | `lib/read-model/attendance-details/` | `modules/attendance/server/sync/` |
| User locations | `lib/read-model/user-locations/` | `modules/attendance/server/sync/user-locations/` |
| ARCP | `modules/arcp-claims/server/sync/` | already in module |
