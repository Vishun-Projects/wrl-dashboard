# Attendance module (Service Call Activity)

## Why this exists

Admin **technician activity report**: CRM attendance / service-call activity rows with rich filters (office, technician, call type, serial, repair done, activity vs call date windows). Used from `/admin/attendance` for ops review and CSV export. Org-level display settings (e.g. column thresholds) live here; heavy SQL is in `@/sql/attendance/*`.

```text
/admin/attendance  →  attendance-page-client (app/)
        ↓
GET /api/admin/attendance  (rows | meta | related | export=csv)
PUT /api/admin/attendance/settings  (org settings)
        ↓
@/sql/attendance/activity-report + activity-metrics
        ↓
CRM attendance tables (read-only)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Page UI (large client component) | `src/app/admin/attendance/attendance-page-client.tsx` |
| Activity SQL builders | `@/sql/attendance/activity-report.ts`, `activity-metrics.ts`, `maps-url.ts` |
| RBAC | `manage_users` only (`canAccessPath` hard-coded for `/admin/attendance`) |
| Security audit logging | `@/lib/security/audit` (if added for exports) |
| Thin stubs | `src/app/admin/attendance/page.tsx`, `src/app/api/admin/attendance/*` |

**Note:** This module has no `pages/` folder — the page client stayed under `src/app/admin/attendance/` because it predates full module extraction.

## Layout

```text
services/
  org-settings.ts           Load/save org attendance settings (Postgres)
  org-settings-defaults.ts  Fallback thresholds + types
server/routes/
  list.ts      GET activity report (rows, meta, CSV, related activities)
  settings.ts  PUT org settings
```

---

## Core flows

1. Admin with `manage_users` opens `/admin/attendance`.
2. Default activity window = last 2 days through today; optional separate call-date range.
3. `meta=offices|callTypes|headerValues` loads filter dropdown data.
4. Paginated rows with `searchBy` + `q` (call, serial, office, technician).
5. `export=csv` runs capped export (`queryActivityReportExport`) with truncation headers.
6. `relatedUserId` + `relatedDay` loads same-day related activities for a technician row.
7. Settings API persists org overrides used when rendering/exporting rows.

---

## Invariants (easy to break)

1. **Admin only** — both routes check `manage_users`; not a report `pageId` in the catalog.
2. **YMD validation** — dates must match `YYYY-MM-DD` or fall back to defaults.
3. **Page size cap** — `pageSize` max 100 on list endpoint.
4. **Settings on every response** — list/meta endpoints include `settings` so the UI stays consistent after org changes.
5. **SQL ownership** — do not duplicate activity queries here; extend `@/sql/attendance/*`.

---

## Where to look

| Need | Place |
|------|--------|
| Page UI | `src/app/admin/attendance/attendance-page-client.tsx` |
| List API | `server/routes/list.ts` |
| Org settings API | `server/routes/settings.ts` |
| Settings types / defaults | `services/org-settings-defaults.ts` |
| SQL | `@/sql/attendance/activity-report.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| New filter field | `list.ts` parsers, SQL builder, page client filter UI |
| Export columns | `buildActivityReportCsv`, page export button |
| Org setting keys | `org-settings.ts`, defaults, page client |
| Access control | `rbac-catalog` `canAccessPath`, nav link in sync admin |
