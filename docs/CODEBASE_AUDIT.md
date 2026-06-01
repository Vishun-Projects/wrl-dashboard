# Codebase Audit Summary

Executed: 2026-06-01  
Scope: `src/` (~171 TS/TSX files), Prisma schema, selected docs.

## Phase 1 — Orphans removed

| Action | Items |
|--------|--------|
| **Deleted (6 components)** | `DateRangePicker`, `FlaggingDisclaimer`, `LocationAuditGapSvg`, `Navbar`, `SummaryBar`, `Tooltip` |
| **Deleted (API routes)** | `/api/distribution`, `/api/admin/clear-cache`, `/api/sync`, `/api/sync/status`, `/api/sync/stop` |
| **Deleted (modules)** | `PostgresAutoSync.tsx`, `read-model/queries/distribution.ts` |
| **Trimmed exports** | `trigger-sync-client` (status fetch only), `nominatim` (cache admin only), `report-sync` dead delta helpers, `client-flags`, `register-excel-export` |
| **Schema** | Removed `CallsCache` / `calls_cache` from Prisma |

### Kept [REVIEW NEEDED]

| Item | Reason |
|------|--------|
| `sync-proxy/*` | Used by `docs/db-sync-tool.html` |
| `POST /api/read-model/sync` | Admin sync page / ops |
| `location-audit/cache` | Admin cache API; no UI yet |
| `read-model/cli.ts` + worker modules | `package.json` `sync-worker*` scripts |

## Phase 2–3 — DRY consolidation (implemented)

| Module | Purpose |
|--------|---------|
| [`src/lib/auth/report-security.ts`](../src/lib/auth/report-security.ts) | `HOD_ROLES`, `resolveReportSecurity`, `isHodUser` |
| [`src/lib/auth/require-permission.ts`](../src/lib/auth/require-permission.ts) | `forbiddenUnless`, permission helpers |
| [`src/lib/csv-utils.ts`](../src/lib/csv-utils.ts) | `escapeCsvCell` |
| [`src/lib/geo/format-distance.ts`](../src/lib/geo/format-distance.ts) | `formatDistanceMeters` |
| [`src/lib/geo/india-states.ts`](../src/lib/geo/india-states.ts) | `getGeographicDetails`, `CITY_TO_STATE_MAP` |
| [`src/lib/report-geo.ts`](../src/lib/report-geo.ts) | `enrichCallRowForReport`, franchisee constants |
| [`src/lib/async-utils.ts`](../src/lib/async-utils.ts) | `sleep` |
| [`src/lib/read-model/coerce.ts`](../src/lib/read-model/coerce.ts) | `toBigInt` |
| [`src/lib/read-model/dates.ts`](../src/lib/read-model/dates.ts) | `maxCrmWatermarks` |
| [`src/lib/read-model/arcp/constants.ts`](../src/lib/read-model/arcp/constants.ts) | Unified `ARCP_NCODE_SHARD_INITIAL` (16) |
| [`src/lib/call-row/normalize.ts`](../src/lib/call-row/normalize.ts) | `normalizeCrmCallRow` |
| [`src/lib/register-table-columns.ts`](../src/lib/register-table-columns.ts) | `REGISTER_EXPORT_COLUMNS` |
| [`src/lib/trhcalls/office-security.ts`](../src/lib/trhcalls/office-security.ts) | Office SQL scoping |

## Phase 4–5 — Structure improvements

| Change | Before | After |
|--------|--------|-------|
| Register API | `report/route.ts` ~1056 lines | [`register-handler.ts`](../src/lib/register-handler.ts) + 10-line route |
| Location audit | Monolithic `location-audit.ts` | Types + CSV in [`location-audit/`](../src/lib/location-audit/); SQL/analyze remain in main file |
| DB pools | Separate `prisma` + sync `getPool` | App routes use `withAppClient` / `getAppPool`; sync worker keeps direct pool |
| User-facing errors | Raw `err.message` in APIs | `toUserFacingError` on register + location-audit |

### Remaining SOLID debt (not fully split)

- [`trhcalls-query.ts`](../src/lib/trhcalls-query.ts) (~825 lines) — office security extracted; further splits (corpus SQL, serial audit SQL) deferred
- [`location-audit.ts`](../src/lib/location-audit.ts) — SQL + analyze still in one file (~480 lines)
- Drilldown / portal filter switch registries — unchanged

## Verification

- `npm run build` — pass
- Distribution data path: `ReportFiltersContext` → `/api/report/corpus` (not deleted distribution route)

## Metrics (approximate)

| Metric | Count |
|--------|-------|
| Files deleted | 14 |
| Lines removed (orphans + routes) | ~32,000+ |
| New shared modules | 15 |
| `report/route.ts` lines | 1056 → 10 |

## Maintainability & operations (post-audit)

| Area | Status |
|------|--------|
| **Sync-proxy auth** | `SYNC_PROXY_SECRET` bearer or admin JWT (`manage_users`); table allowlist; `SYNC_PROXY_MAX_LIMIT` cap |
| **Report limits** | `REPORT_MAX_ROWS` / `SYNC_PROXY_MAX_LIMIT` in [`report-limits.ts`](../src/lib/report-limits.ts) |
| **Sync docs** | [`docs/sync.md`](sync.md) updated for daemon (no browser auto-sync) |
| **Bearer auth helper** | [`resolve-bearer-security.ts`](../src/lib/auth/resolve-bearer-security.ts) for report APIs |

Run `npm run knip` after `npm install` (add `knip` devDependency if not yet installed) to catch unused exports.

## Follow-up recommendations

1. Install knip: `npm i -D knip` then `npm run knip` before large PRs
2. Wire location-audit cache admin UI or document ops-only DELETE/GET
3. Complete `trhcalls-query` split and `location-audit` sql/analyze modules when next touching those features
4. Extract `corpus-handler.ts` and thin `register-handler.ts` when editing those flows
