# Development History & Changelog

> **Repository:** fast-close-app  
> **Generated:** 2026-06-01 04:36:20 UTC  
> **Period:** 2026-05-12 → 2026-05-29  
> **Total commits:** 52  
> **Contributors:** VV <vishun.orv@gmail.com>  
> **Lines changed (approx.):** +451,620 / -23,495

---

## Executive Summary

This document is an audit of the complete Git history for **fast-close-app**, a Next.js MIS/reporting application for field-service operations (calls, distribution, ARCP claims, serial audit, register exports). Development spans **3 weeks** (2026-05-12 to 2026-05-29), with **52 commits** by a single contributor (**VV**).

### Milestones

| Date | Milestone |
|------|-----------|
| 2026-05-12 | **Initial commit** — Next.js app scaffold via Create Next App |
| 2026-05-14 | First feature commit — mobile fixes, visits tab |
| 2026-05-15 | **Reports module** — MIS reports page, Excel export, summary dashboard verification |
| 2026-05-16 | **Security** — middleware and auth hardening |
| 2026-05-18 | **RBAC & profile settings**, Vercel deployment, performance work |
| 2026-05-19–20 | Client-side performance (localStorage), calls page, MIS localStorage indexing |
| 2026-05-21 | Performance optimizations (localStorage reload technique) |
| 2026-05-22 | Branch manager view; experimental `tried-for-server-cache` branch |
| 2026-05-25 | **Read-model phase** — corpus caching, register filters, serial audit APIs |
| 2026-05-26–27 | New DB integrations, ARCP claims page, serial-wise history, cron jobs |
| 2026-05-27 | Excel export bug fix, performance tuning, Vercel cron removal |
| 2026-05-29 | **ARCP Postgres sync** (Jan 2025–May 2026 data), idle technician distribution, CRM label cleanup |

### Commit Categories (all commits, multi-tag allowed)

| Category | Count |
|----------|-------|
| FEATURE | 28 |
| DOCS | 11 |
| CONFIG | 9 |
| STYLE / UI | 9 |
| SCHEMA / DB | 8 |
| REFACTOR | 7 |
| UNKNOWN | 7 |
| PERFORMANCE | 7 |
| FIX | 5 |
| INFRA / DEVOPS | 5 |
| INITIAL / SETUP | 3 |
| SECURITY | 2 |

### Branches

| Branch | Tip | Last Updated | Latest Subject |
|--------|-----|--------------|----------------|
| `main` | `f1013f5` | 2026-05-29 | removed crm mentionings |
| `tried-for-server-cache` | `4a2187c` | 2026-05-22 | shayad use ho? |
| `origin/main` | `f1013f5` | 2026-05-29 | removed crm mentionings |

### Tags / Releases

_No tags found in repository._

---

## Timeline by Month

### May 2026

- **Commits:** 52
- **Lines:** +451,620 / -23,495
- **Highlights:** removed crm mentionings; updated calls distribution for idle technicians; updated arcp claims data from jan 2025 till 28 may 26; excel bug resolved; phir wohi dukh…

---

## Timeline by Week

### Week of 2026-05-25

_18 commit(s)_

#### `f1013f5` — removed crm mentionings
- **When:** 2026-05-29 13:46:35
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** HEAD -> main, origin/main
- **Category:** REFACTOR
- **Stats:** 6 files, +26/-164 lines
- **Purpose:** Remove CRM-specific terminology from user-facing copy and error messages.
  - **Modified (6):** `src/components/PostgresAutoSync.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/db-proxy.ts`, `src/lib/read-model/client-flags.ts`, `src/lib/register-export-fetch.ts`, `src/lib/user-facing-errors.ts`

#### `1ca8fee` — removed crm mentionings
- **When:** 2026-05-29 13:42:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR
- **Stats:** 22 files, +239/-235 lines
- **Purpose:** Remove CRM-specific terminology from user-facing copy and error messages.
  - **Added (1):** `src/lib/user-facing-errors.ts`
  - **Modified (21):** `src/app/api/distribution/route.ts`, `src/app/api/read-model/sync/route.ts`, `src/app/api/report/arcp-claims/detail/route.ts`, `src/app/api/report/arcp-claims/route.ts`, `src/app/api/report/corpus/route.ts`, `src/app/report/arcp-claims/page.tsx`, +15 more

#### `d1c0fff` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:29:06
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +9/-0 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Modified (1):** `src/lib/read-model/arcp/incremental.ts`

#### `7408f27` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:27:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +5/-4 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Modified (1):** `src/app/report/page.tsx`

#### `2ae99ca` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:23:55
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, STYLE / UI
- **Stats:** 25 files, +2061/-287 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Added (6):** `scripts/arcp-nightly.ps1`, `src/components/DistributionActiveFilters.tsx`, `src/components/DistributionTablePanel.tsx`, `src/lib/distribution-engineer-roster-cache.ts`, `src/lib/distribution-idle-assignees.ts`, `src/lib/read-model/arcp/coverage-query.ts`
  - **Modified (19):** `.gitignore`, `docs/sync.md`, `package.json`, `src/app/api/report/engineers/route.ts`, `src/app/globals.css`, `src/app/report/distribution/page.tsx`, +13 more

#### `c784558` — updated arcp claims data from jan 2025 till 28 may 26
- **When:** 2026-05-29 09:52:51
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, SCHEMA / DB
- **Stats:** 67 files, +5715/-571 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Added (34):** `docs/arcp-trends-overview.html`, `docs/read-model-phase1-schema/08-arcp_lines_hot.sql`, `docs/read-model-phase1-schema/09-arcp_bm_ho_approve_columns.sql`, `docs/sync.md`, `requirements-sync.txt`, `scripts/apply-read-model-schema.mjs`, `scripts/check-sync-status.ts`, `scripts/generate-arcp-trends-html.ts`, +26 more
  - **Modified (29):** `docs/read-model-cutover-checklist.md`, `docs/read-model-infra-gate.md`, `docs/read-model-phase1-schema/07-seed-sync-state.sql`, `package.json`, `src/app/admin/sync/page.tsx`, `src/app/api/read-model/sync/route.ts`, +23 more
  - **Deleted (4):** `src/app/api/read-model/cron/incremental/route.ts`, `src/app/api/read-model/cron/nightly/route.ts`, `src/app/api/read-model/cron/retention/route.ts`, `src/lib/read-model/cron-auth.ts`

#### `25031f0` — excel bug resolved
- **When:** 2026-05-27 16:32:47
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, FIX
- **Stats:** 6 files, +600/-268 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Added (1):** `src/lib/register-excel-export.ts`
  - **Modified (5):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/register-csv-export.ts`, `src/lib/register-export-fetch.ts`

#### `2cc06f4` — phir wohi dukh
- **When:** 2026-05-27 15:46:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** SCHEMA / DB
- **Stats:** 10 files, +361/-221 lines
- **Purpose:** Touches primarily: src/lib/read-model, src/app/api, src/app/report, src/components, src/contexts.
  - **Modified (10):** `src/app/api/read-model/sync/route.ts`, `src/app/report/page.tsx`, `src/components/DashboardLayout.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/auth.ts`, `src/lib/prisma.ts`, +4 more

#### `36e28ae` — date range error
- **When:** 2026-05-27 15:32:33
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FIX
- **Stats:** 5 files, +82/-19 lines
- **Purpose:** Touches primarily: src/app/report, src/components, src/contexts, src/lib/report-corpus-storage.ts, src/lib/report-filters.ts.
  - **Modified (5):** `src/app/report/page.tsx`, `src/components/DateRangeSelector.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/report-corpus-storage.ts`, `src/lib/report-filters.ts`

#### `4c6f9ed` — trying to resolve speed
- **When:** 2026-05-27 15:16:55
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 6 files, +367/-40 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/contexts, src/lib/read-model, src/lib/register-export-fetch.ts.
  - **Modified (6):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/register-export-fetch.ts`, `src/lib/report-corpus-storage.ts`

#### `8744e6f` — trying to resolve speed
- **When:** 2026-05-27 15:07:19
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 5 files, +252/-3 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/contexts, src/lib/read-model, src/lib/report-register-view.ts.
  - **Modified (5):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/report-register-view.ts`

#### `35ef162` — removed vercel cron
- **When:** 2026-05-27 14:57:39
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS, REFACTOR
- **Stats:** 2 files, +10/-24 lines
- **Purpose:** Cron job configuration for read-model sync (later removed from Vercel).
  - **Modified (1):** `src/app/admin/sync/page.tsx`
  - **Deleted (1):** `vercel.json`

#### `bdd640c` — updated for cron jobs
- **When:** 2026-05-27 14:51:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, INFRA / DEVOPS
- **Stats:** 6 files, +138/-2 lines
- **Purpose:** Cron job configuration for read-model sync (later removed from Vercel).
  - **Added (5):** `src/app/api/read-model/cron/incremental/route.ts`, `src/app/api/read-model/cron/nightly/route.ts`, `src/app/api/read-model/cron/retention/route.ts`, `src/lib/read-model/cron-auth.ts`, `vercel.json`
  - **Modified (1):** `src/app/admin/sync/page.tsx`

#### `52e5f37` — updated the mis reports page, added arcp claims and serial wise history page
- **When:** 2026-05-27 14:36:15
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 7 files, +16/-270 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Modified (3):** `scripts/verify-arcp-tally.ts`, `src/app/api/calls/[id]/route.ts`, `src/lib/read-model/backfill.ts`
  - **Deleted (4):** `scripts/apply-read-model-schema.mjs`, `scripts/check-read-model-locks.mjs`, `scripts/check-read-model-status.mjs`, `scripts/count-major-minor.mjs`

#### `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page
- **When:** 2026-05-27 14:24:07
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, SCHEMA / DB
- **Stats:** 79 files, +11387/-353 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Added (61):** `docs/read-model-cutover-checklist.md`, `docs/read-model-infra-gate.md`, `docs/read-model-phase1-architecture.md`, `docs/read-model-phase1-schema.sql`, `docs/read-model-phase1-schema/01-extensions.sql`, `docs/read-model-phase1-schema/02-enums.sql`, `docs/read-model-phase1-schema/03-calls_latest_hot.sql`, `docs/read-model-phase1-schema/04-call_metrics_daily.sql`, +53 more
  - **Modified (18):** `package-lock.json`, `package.json`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/call-types/route.ts`, `src/app/api/report/corpus/route.ts`, +12 more

#### `cb4e2b4` — implementing new dbs and calls
- **When:** 2026-05-26 10:46:30
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 10 files, +1245/-429 lines
- **Purpose:** Touches primarily: src/app/report, src/app/api, src/contexts, src/lib/db-proxy.ts, src/lib/report-corpus.ts.
  - **Modified (10):** `src/app/api/report/corpus/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/app/report/serial-audit/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/db-proxy.ts`, +4 more

#### `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs.
- **When:** 2026-05-25 15:03:50
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, STYLE / UI
- **Stats:** 37 files, +5883/-1008 lines
- **Purpose:** Serial-wise history audit page and related APIs.
  - **Added (17):** `scripts/count-major-minor.mjs`, `src/app/api/report/corpus/route.ts`, `src/app/api/report/serial-audit/route.ts`, `src/components/RegisterActiveFilterChips.tsx`, `src/components/RegisterCompactToolbar.tsx`, `src/components/RegisterFilterDrawer.tsx`, `src/components/RegisterPageFilters.tsx`, `src/components/RegisterStatsBar.tsx`, +9 more
  - **Modified (20):** `.gitignore`, `src/app/api/distribution/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/globals.css`, +14 more

#### `6ea3e2b` — first commit
- **When:** 2026-05-25 14:59:45
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, INITIAL / SETUP
- **Stats:** 1 files, +1/-0 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Modified (1):** `README.md`

### Week of 2026-05-18

_19 commit(s)_

#### `9c4b6ae` — let's check ui
- **When:** 2026-05-22 16:50:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, STYLE / UI
- **Stats:** 39 files, +6118/-4614 lines
- **Purpose:** Touches primarily: src/components, src/app/api, src/app/report, src/app/admin, .vscode.
  - **Added (18):** `.vscode/settings.json`, `src/app/report/layout.tsx`, `src/app/report/serial-audit/page.tsx`, `src/components/PageShell.tsx`, `src/components/RegisterBranchFranchiseeFilters.tsx`, `src/components/RegisterColumnPicker.tsx`, `src/components/RegisterFilterBar.tsx`, `src/components/RegisterMultiSelect.tsx`, +10 more
  - **Modified (15):** `src/app/admin/page.tsx`, `src/app/admin/roles/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/api/distribution/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +9 more
  - **Deleted (6):** `src/app/api/calls/route.ts`, `src/app/calls/page.tsx`, `src/components/CallCard.tsx`, `src/components/CallTable.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`

#### `6c10254` — updated for branch manager to see proper view
- **When:** 2026-05-22 11:22:04
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 8 files, +87/-143 lines
- **Purpose:** Branch-manager scoped view and sidebar navigation.
  - **Modified (8):** `src/app/api/calls/route.ts`, `src/app/api/comments/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +2 more

#### `1f6803e` — updating sidebar
- **When:** 2026-05-22 10:56:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 6 files, +165/-218 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/components.
  - **Modified (6):** `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/components/Sidebar.tsx`

#### `4a2187c` — shayad use ho?
- **When:** 2026-05-22 10:31:49
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** tried-for-server-cache
- **Category:** UNKNOWN
- **Stats:** 19 files, +2165/-2091 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/components, scratch-test.js, src/app/calls.
  - **Added (6):** `scratch-test.js`, `src/lib/call-queries.ts`, `src/lib/global-cache.ts`, `test-query.js`, `test-query.ts`, `test-shared-data.js`
  - **Modified (13):** `src/app/api/calls/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +7 more

#### `c3eda74` — ab mai karunga saaf aur thik
- **When:** 2026-05-21 13:50:33
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR
- **Stats:** 6 files, +97/-54 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, fix-drilldown.js.
  - **Added (1):** `fix-drilldown.js`
  - **Modified (5):** `src/app/api/calls/[id]/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`

#### `d40212f` — worked on performance added local storage and reload technique
- **When:** 2026-05-21 11:04:28
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 1 files, +1/-5 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (1):** `src/app/calls/page.tsx`

#### `d97ed83` — worked on performance added local storage and reload technique
- **When:** 2026-05-21 11:01:09
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 11 files, +1115/-505 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (11):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/calls/page.tsx`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/components/BranchTree.tsx`, +5 more

#### `76f3b4b` — updated the calls
- **When:** 2026-05-20 15:24:41
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS
- **Stats:** 1 files, +0/-2227 lines
- **Purpose:** Touches primarily: docs.
  - **Deleted (1):** `docs/db-sync-tool.html`

#### `c6d3ee4` — updated the calls
- **When:** 2026-05-20 15:23:44
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +40/-9 lines
- **Purpose:** Touches primarily: src/app/calls.
  - **Modified (1):** `src/app/calls/page.tsx`

#### `92607c1` — updated the /calls page for fetchings
- **When:** 2026-05-20 15:18:05
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 10 files, +816/-666 lines
- **Purpose:** Touches primarily: src/app/api, src/components, src/app/calls, src/app/report, src/lib/db-proxy.ts.
  - **Modified (10):** `src/app/api/calls/[id]/route.ts`, `src/app/api/calls/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/calls/page.tsx`, +4 more

#### `9eec406` — updated mis report to localstorage index the calls
- **When:** 2026-05-20 12:49:57
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, PERFORMANCE, SCHEMA / DB
- **Stats:** 13 files, +154940/-728 lines
- **Purpose:** Touches primarily: src/app/api, docs, src/app/report.
  - **Added (6):** `docs/Manisha Sundar Pawar.pdf`, `docs/WesternCRM_Schema_Blueprint.sql`, `docs/db-sync-tool.html`, `docs/mstcity_backup.json`, `src/app/api/sync-proxy/[table]/route.ts`, `src/app/api/sync-proxy/sizes/route.ts`
  - **Modified (7):** `src/app/api/calls/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, +1 more

#### `f3cc8d3` — removed tech solved column from summary dashboard and key account mis
- **When:** 2026-05-20 09:12:52
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, REFACTOR
- **Stats:** 1 files, +1/-11 lines
- **Purpose:** Touches primarily: src/app/report.
  - **Modified (1):** `src/app/report/page.tsx`

#### `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors
- **When:** 2026-05-19 16:55:22
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR
- **Stats:** 9 files, +107/-652 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (1):** `src/app/report/distribution/page.tsx`
  - **Deleted (8):** `scratch_count_check.js`, `scratch_get_users.ts`, `scratch_query.js`, `src/app/report/distribution/analyze_csv.js`, `src/app/report/distribution/check_pincode_map.js`, `src/app/report/distribution/inspect.js`, `src/app/report/distribution/inspect.ts`, `test_counts.ts`

#### `ec2a795` — added new page and worked on ensuring correct data is shown
- **When:** 2026-05-19 16:46:53
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, STYLE / UI
- **Stats:** 20 files, +168345/-51 lines
- **Purpose:** Touches primarily: src/app/report, src/app/api, docs, package-lock.json, package.json.
  - **Added (10):** `docs/PincodMatrix.csv`, `scratch_get_users.ts`, `scratch_query.js`, `src/app/api/distribution/route.ts`, `src/app/report/distribution/analyze_csv.js`, `src/app/report/distribution/check_pincode_map.js`, `src/app/report/distribution/inspect.js`, `src/app/report/distribution/inspect.ts`, +2 more
  - **Modified (10):** `package-lock.json`, `package.json`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/globals.css`, +4 more

#### `2ae9e25` — deploying on vercel
- **When:** 2026-05-18 16:39:20
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS
- **Stats:** 1 files, +0/-3 lines
- **Purpose:** Vercel deployment configuration and type-error fixes.
  - **Deleted (1):** `src/app/api/temp-check/route.ts`

#### `bb9a610` — deploying on vercel
- **When:** 2026-05-18 16:36:38
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS
- **Stats:** 3 files, +13/-81 lines
- **Purpose:** Vercel deployment configuration and type-error fixes.
  - **Modified (1):** `src/app/profile/page.tsx`
  - **Deleted (2):** `src/app/report/test_raw.ts`, `src/app/report/test_raw_month.ts`

#### `aac337f` — removed js scripts
- **When:** 2026-05-18 15:59:15
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR, SCHEMA / DB
- **Stats:** 19 files, +0/-1004 lines
- **Purpose:** Touches primarily: scratch, scripts.
  - **Deleted (19):** `scratch/add-avatar-column.js`, `scratch/add_avatar_column.js`, `scratch/check_constraint.js`, `scratch/check_rls.js`, `scratch/check_storage_policies.js`, `scratch/db_test.js`, `scratch/drop_constraint.js`, `scratch/fix_rls.js`, `scratch/inspect_mssql.js`, `scratch/inspect_mssql.ts`, `scratch/inspect_schema.ts`, `scratch/inspect_uv.ts`, `scratch/inspect_view_def.ts`, `scratch/migrate_roles.sql`, `scratch/run_migration.ts`, `scratch/setup_storage.js`, `scratch/test_db_queries.ts`, `scratch/view_def.sql`, `scripts/replace-typography.js`

#### `e2665fe` — updated for performance
- **When:** 2026-05-18 15:58:49
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI
- **Stats:** 43 files, +1939/-889 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Added (11):** `public/test_count.json`, `scratch/db_test.js`, `scratch/inspect_view_def.ts`, `scratch/view_def.sql`, `scratch_count_check.js`, `scripts/replace-typography.js`, `src/app/api/temp-check/route.ts`, `src/app/report/test_raw.ts`, +3 more
  - **Modified (28):** `scratch/inspect_uv.ts`, `src/app/admin/page.tsx`, `src/app/admin/roles/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/api/calls/[id]/route.ts`, `src/app/api/calls/route.ts`, +22 more
  - **Deleted (4):** `test-dates.ts`, `test-dates2.ts`, `test-dates3.ts`, `test-dates4.ts`

#### `f67ed4e` — updated layout and filterings and added profile setting and rbac page
- **When:** 2026-05-18 10:51:31
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, SCHEMA / DB, SECURITY, STYLE / UI
- **Stats:** 44 files, +3271/-515 lines
- **Purpose:** RBAC admin page and user profile settings.
  - **Added (24):** `scratch/add-avatar-column.js`, `scratch/add_avatar_column.js`, `scratch/check_constraint.js`, `scratch/check_rls.js`, `scratch/check_storage_policies.js`, `scratch/drop_constraint.js`, `scratch/fix_rls.js`, `scratch/inspect_mssql.js`, +16 more
  - **Modified (19):** `prisma/schema.prisma`, `src/app/admin/users/page.tsx`, `src/app/api/admin/users/password/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/calls/route.ts`, `src/app/api/comments/route.ts`, +13 more
  - **Deleted (1):** `src/app/api/debug-columns/route.ts`

### Week of 2026-05-11

_15 commit(s)_

#### `e6c2256` — added middlewares and securities
- **When:** 2026-05-16 11:15:47
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, SECURITY
- **Stats:** 35 files, +629/-2705 lines
- **Purpose:** Auth middleware and security hardening.
  - **Added (4):** `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts`
  - **Modified (20):** `package-lock.json`, `package.json`, `public/WRL_MIS_Report_2026-05-15 (1).xlsx`, `public/WRL_MIS_Report_2026-05-15.xlsx`, `src/app/admin/users/page.tsx`, `src/app/api/admin/users/password/route.ts`, +14 more
  - **Deleted (11):** `public/WRL_Detailed_Breakdown_2026-05-15 (1).xlsx`, `public/WRL_Detailed_Breakdown_2026-05-15.xlsx`, `public/WRL_MIS_Report_2026-05-15 (1).xls`, `public/WRL_MIS_Report_2026-05-15 (2).xls`, `public/WRL_MIS_Report_2026-05-15 (3).xls`, `public/WRL_MIS_Report_2026-05-15 (4).xls`, `public/WRL_MIS_Report_2026-05-15 (5).xls`, `public/WRL_MIS_Report_2026-05-15.csv`, `public/WRL_MIS_Report_2026-05-15.xls`, `public/~$WRL_MIS_Report_2026-05-15 (1).xlsx`, `src/lib/supabase.ts`

#### `3c40420` — updated branch search to have typeset also updated summary dashboard to show all counts not just breakdown
- **When:** 2026-05-15 15:36:07
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 3 files, +177/-16 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report.
  - **Modified (3):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`

#### `4f51d38` — now reports are verified for key mis and summary dashboard
- **When:** 2026-05-15 15:13:13
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 17 files, +334/-309 lines
- **Purpose:** Touches primarily: public, scratch, src/app/api, src/app/report, test-dates.ts.
  - **Added (9):** `public/WRL_Detailed_Breakdown_2026-05-15 (1).xlsx`, `public/WRL_Detailed_Breakdown_2026-05-15.xlsx`, `public/WRL_MIS_Report_2026-05-15 (1).xlsx`, `public/WRL_MIS_Report_2026-05-15.csv`, `public/~$WRL_MIS_Report_2026-05-15 (1).xlsx`, `test-dates.ts`, `test-dates2.ts`, `test-dates3.ts`, +1 more
  - **Modified (3):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`
  - **Deleted (5):** `scratch/check_dupes.js`, `scratch/debug_summary.js`, `scratch/get_april_stats.js`, `scratch/get_summary.js`, `scratch/test_date_format.js`

#### `e9ff2ef` — testing for reports discrepencies
- **When:** 2026-05-15 14:03:05
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 12 files, +733/-119 lines
- **Purpose:** Touches primarily: scratch, src/app/api, src/app/report, src/lib/db-proxy.ts.
  - **Added (8):** `scratch/check_dupes.js`, `scratch/debug_summary.js`, `scratch/get_april_stats.js`, `scratch/get_summary.js`, `scratch/test_date_format.js`, `src/app/api/debug-columns/route.ts`, `src/app/api/report/call-types/route.ts`, `src/app/api/report/drilldown/route.ts`
  - **Modified (4):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`, `src/lib/db-proxy.ts`

#### `49660ff` — excel export done
- **When:** 2026-05-15 12:26:12
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 2 files, +0/-70 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Deleted (2):** `scratch/check_mapping.ts`, `scratch/debug_mapping.js`

#### `44466b2` — excel export done
- **When:** 2026-05-15 12:25:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, FEATURE
- **Stats:** 13 files, +3784/-102 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Added (9):** `public/WRL_MIS_Report_2026-05-15 (1).xls`, `public/WRL_MIS_Report_2026-05-15 (2).xls`, `public/WRL_MIS_Report_2026-05-15 (3).xls`, `public/WRL_MIS_Report_2026-05-15 (4).xls`, `public/WRL_MIS_Report_2026-05-15 (5).xls`, `public/WRL_MIS_Report_2026-05-15.xls`, `public/WRL_MIS_Report_2026-05-15.xlsx`, `scratch/check_mapping.ts`, +1 more
  - **Modified (4):** `package-lock.json`, `package.json`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`

#### `8fc0485` — reports page refresh once done
- **When:** 2026-05-15 11:44:26
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 1 files, +4/-7 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `src/app/report/page.tsx`

#### `22582d1` — reports page made
- **When:** 2026-05-15 11:39:32
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 1 files, +1/-2 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `src/app/api/report/route.ts`

#### `180743a` — reports page made
- **When:** 2026-05-15 11:37:30
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, FEATURE
- **Stats:** 19 files, +1/-292 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `tsconfig.json`
  - **Deleted (18):** `scratch/check_aa.js`, `scratch/check_hierarchy.js`, `scratch/check_hierarchy.ts`, `scratch/check_indore.js`, `scratch/check_lucknow.js`, `scratch/check_zones.js`, `scratch/find_serial_col.ts`, `scratch/find_statuses.js`, `scratch/find_statuses.ts`, `scratch/find_tables.ts`, `scratch/inspect_calltypes.ts`, `scratch/inspect_db.ts`, `scratch/inspect_party_profile.ts`, `scratch/inspect_partyprofile.ts`, `scratch/inspect_serialno.ts`, `scratch/inspect_serialno_party.ts`, `scratch/inspect_view.ts`, `scratch/inspect_view_all.ts`

#### `b461347` — reports page made
- **When:** 2026-05-15 11:35:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, STYLE / UI
- **Stats:** 30 files, +57867/-13 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Added (24):** `docs/CRM_TableList.xlsb`, `docs/WesternCRM Schema Architect.txt`, `scratch/check_aa.js`, `scratch/check_hierarchy.js`, `scratch/check_hierarchy.ts`, `scratch/check_indore.js`, `scratch/check_lucknow.js`, `scratch/check_zones.js`, +16 more
  - **Modified (6):** `src/app/api/offices/route.ts`, `src/app/globals.css`, `src/components/CallDetail.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`, `src/lib/db-proxy.ts`

#### `3bd5580` — resolved mobile issue and visits tab
- **When:** 2026-05-14 16:06:22
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, FIX
- **Stats:** 8 files, +389/-176 lines
- **Purpose:** Mobile layout fixes and visits tab behavior.
  - **Added (3):** `docs/BD & Deployment MIS.xlsx`, `docs/CRm Call Dashboard.docx`, `src/app/api/admin/users/password/route.ts`
  - **Modified (5):** `src/app/admin/users/page.tsx`, `src/app/api/calls/[id]/route.ts`, `src/app/calls/page.tsx`, `src/app/layout.tsx`, `src/components/CallDetail.tsx`

#### `e76f752` — resolved mobile issue and visits tab
- **When:** 2026-05-14 16:06:16
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, FIX
- **Stats:** 4 files, +54/-18 lines
- **Purpose:** Mobile layout fixes and visits tab behavior.
  - **Modified (4):** `src/app/api/calls/[id]/route.ts`, `src/components/CallDetail.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`

#### `896eb75` — working something
- **When:** 2026-05-14 15:16:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 34 files, +281/-1162 lines
- **Purpose:** Touches primarily: scratch, src/app/api, src/components, .gitignore, check_major.js.
  - **Added (1):** `public/western-head-logo-2025.png`
  - **Modified (9):** `.gitignore`, `src/app/admin/users/page.tsx`, `src/app/api/admin/clear-cache/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/login/page.tsx`, `src/components/CallDetail.tsx`, +3 more
  - **Deleted (24):** `check_major.js`, `scratch/add_started_at.ts`, `scratch/check_cache.js`, `scratch/check_cache.ts`, `scratch/check_cols.js`, `scratch/check_count.js`, `scratch/check_reasons.ts`, `scratch/check_users_schema.ts`, `scratch/diagnose_db.ts`, `scratch/find_reasons.ts`, `scratch/fix_schemas.ts`, `scratch/list_tables.ts`, `scratch/migrate.js`, `scratch/migrate_started_at.ts`, `scratch/purge_cache.js`, `scratch/setup_cache_table.ts`, `scratch/test_items.ts`, `scratch/test_join.ts`, `scratch/test_join_internal.ts`, `scratch/test_link.js`, `scratch/verify_cancel_reason.ts`, `scratch/verify_linkage.ts`, `src/app/api/debug-parts/route.ts`, `ticket_detail_modal.html`

#### `e7c5e1f` — first commit
- **When:** 2026-05-14 15:14:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI
- **Stats:** 66 files, +12752/-140 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Added (59):** `check_major.js`, `docs/BRD_FSD_content.txt`, `docs/SUPABASE_SETUP.md`, `docs/WRL_BRD_FSD_v1.1.docx`, `docs/sourcecodecallview.txt`, `prisma.config.ts`, `prisma/schema.prisma`, `scratch/add_started_at.ts`, +51 more
  - **Modified (7):** `.gitignore`, `README.md`, `package-lock.json`, `package.json`, `src/app/globals.css`, `src/app/layout.tsx`, +1 more

#### `24457c7` — Initial commit from Create Next App
- **When:** 2026-05-12 11:30:24
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI
- **Stats:** 19 files, +6997/-0 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Added (19):** `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `eslint.config.mjs`, `next.config.ts`, `package-lock.json`, `package.json`, +11 more

---

## History by Module / Folder

### `src/app/api` (34 commits)

- **2026-05-29** `1ca8fee` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `c784558` — updated arcp claims data from jan 2025 till 28 may 26 _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-27** `25031f0` — excel bug resolved _[FEATURE, FIX]_
- **2026-05-27** `2cc06f4` — phir wohi dukh _[SCHEMA / DB]_
- **2026-05-27** `4c6f9ed` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `8744e6f` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `bdd640c` — updated for cron jobs _[FEATURE, INFRA / DEVOPS]_
- **2026-05-27** `52e5f37` — updated the mis reports page, added arcp claims and serial wise history page _[FEATURE]_
- **2026-05-27** `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-26** `cb4e2b4` — implementing new dbs and calls _[UNKNOWN]_
- **2026-05-25** `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs. _[FEATURE, STYLE / UI]_
- **2026-05-22** `9c4b6ae` — let's check ui _[FEATURE, STYLE / UI]_
- **2026-05-22** `6c10254` — updated for branch manager to see proper view _[UNKNOWN]_
- **2026-05-22** `1f6803e` — updating sidebar _[FEATURE]_
- **2026-05-22** `4a2187c` — shayad use ho? _[UNKNOWN]_
- **2026-05-21** `c3eda74` — ab mai karunga saaf aur thik _[REFACTOR]_
- **2026-05-21** `d97ed83` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-20** `92607c1` — updated the /calls page for fetchings _[FEATURE]_
- **2026-05-20** `9eec406` — updated mis report to localstorage index the calls _[DOCS, FEATURE, PERFORMANCE, SCHEMA / DB]_
- **2026-05-19** `ec2a795` — added new page and worked on ensuring correct data is shown _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-18** `2ae9e25` — deploying on vercel _[INFRA / DEVOPS]_
- **2026-05-18** `e2665fe` — updated for performance _[FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI]_
- **2026-05-18** `f67ed4e` — updated layout and filterings and added profile setting and rbac page _[FEATURE, SCHEMA / DB, SECURITY, STYLE / UI]_
- **2026-05-16** `e6c2256` — added middlewares and securities _[CONFIG, SECURITY]_
- **2026-05-15** `3c40420` — updated branch search to have typeset also updated summary dashboard to show all counts not just breakdown _[FEATURE]_
- **2026-05-15** `4f51d38` — now reports are verified for key mis and summary dashboard _[FEATURE]_
- **2026-05-15** `e9ff2ef` — testing for reports discrepencies _[FEATURE]_
- **2026-05-15** `44466b2` — excel export done _[CONFIG, FEATURE]_
- **2026-05-15** `22582d1` — reports page made _[FEATURE]_
- **2026-05-15** `b461347` — reports page made _[DOCS, FEATURE, STYLE / UI]_
- **2026-05-14** `3bd5580` — resolved mobile issue and visits tab _[DOCS, FEATURE, FIX]_
- **2026-05-14** `e76f752` — resolved mobile issue and visits tab _[FEATURE, FIX]_
- **2026-05-14** `896eb75` — working something _[UNKNOWN]_
- **2026-05-14** `e7c5e1f` — first commit _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI]_

### `src/app/report` (27 commits)

- **2026-05-29** `1ca8fee` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `7408f27` — updated calls distribution for idle technicians _[UNKNOWN]_
- **2026-05-29** `2ae99ca` — updated calls distribution for idle technicians _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-27** `25031f0` — excel bug resolved _[FEATURE, FIX]_
- **2026-05-27** `2cc06f4` — phir wohi dukh _[SCHEMA / DB]_
- **2026-05-27** `36e28ae` — date range error _[FIX]_
- **2026-05-27** `4c6f9ed` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `8744e6f` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-26** `cb4e2b4` — implementing new dbs and calls _[UNKNOWN]_
- **2026-05-25** `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs. _[FEATURE, STYLE / UI]_
- **2026-05-22** `9c4b6ae` — let's check ui _[FEATURE, STYLE / UI]_
- **2026-05-22** `6c10254` — updated for branch manager to see proper view _[UNKNOWN]_
- **2026-05-22** `1f6803e` — updating sidebar _[FEATURE]_
- **2026-05-22** `4a2187c` — shayad use ho? _[UNKNOWN]_
- **2026-05-21** `c3eda74` — ab mai karunga saaf aur thik _[REFACTOR]_
- **2026-05-21** `d97ed83` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-20** `92607c1` — updated the /calls page for fetchings _[FEATURE]_
- **2026-05-20** `9eec406` — updated mis report to localstorage index the calls _[DOCS, FEATURE, PERFORMANCE, SCHEMA / DB]_
- **2026-05-20** `f3cc8d3` — removed tech solved column from summary dashboard and key account mis _[FEATURE, REFACTOR]_
- **2026-05-19** `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors _[FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR]_
- **2026-05-19** `ec2a795` — added new page and worked on ensuring correct data is shown _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-18** `bb9a610` — deploying on vercel _[INFRA / DEVOPS]_
- **2026-05-18** `e2665fe` — updated for performance _[FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI]_
- **2026-05-15** `3c40420` — updated branch search to have typeset also updated summary dashboard to show all counts not just breakdown _[FEATURE]_
- **2026-05-15** `4f51d38` — now reports are verified for key mis and summary dashboard _[FEATURE]_
- **2026-05-15** `e9ff2ef` — testing for reports discrepencies _[FEATURE]_
- **2026-05-15** `8fc0485` — reports page refresh once done _[FEATURE]_

### `src/components` (20 commits)

- **2026-05-29** `f1013f5` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `1ca8fee` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `2ae99ca` — updated calls distribution for idle technicians _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-29** `c784558` — updated arcp claims data from jan 2025 till 28 may 26 _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-27** `2cc06f4` — phir wohi dukh _[SCHEMA / DB]_
- **2026-05-27** `36e28ae` — date range error _[FIX]_
- **2026-05-27** `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-25** `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs. _[FEATURE, STYLE / UI]_
- **2026-05-22** `9c4b6ae` — let's check ui _[FEATURE, STYLE / UI]_
- **2026-05-22** `6c10254` — updated for branch manager to see proper view _[UNKNOWN]_
- **2026-05-22** `1f6803e` — updating sidebar _[FEATURE]_
- **2026-05-22** `4a2187c` — shayad use ho? _[UNKNOWN]_
- **2026-05-21** `d97ed83` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-20** `92607c1` — updated the /calls page for fetchings _[FEATURE]_
- **2026-05-18** `e2665fe` — updated for performance _[FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI]_
- **2026-05-18** `f67ed4e` — updated layout and filterings and added profile setting and rbac page _[FEATURE, SCHEMA / DB, SECURITY, STYLE / UI]_
- **2026-05-15** `b461347` — reports page made _[DOCS, FEATURE, STYLE / UI]_
- **2026-05-14** `e76f752` — resolved mobile issue and visits tab _[FEATURE, FIX]_
- **2026-05-14** `896eb75` — working something _[UNKNOWN]_
- **2026-05-14** `e7c5e1f` — first commit _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI]_

### `src/lib/read-model` (12 commits)

- **2026-05-29** `f1013f5` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `1ca8fee` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `d1c0fff` — updated calls distribution for idle technicians _[UNKNOWN]_
- **2026-05-29** `2ae99ca` — updated calls distribution for idle technicians _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-29** `c784558` — updated arcp claims data from jan 2025 till 28 may 26 _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-27** `25031f0` — excel bug resolved _[FEATURE, FIX]_
- **2026-05-27** `2cc06f4` — phir wohi dukh _[SCHEMA / DB]_
- **2026-05-27** `4c6f9ed` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `8744e6f` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `bdd640c` — updated for cron jobs _[FEATURE, INFRA / DEVOPS]_
- **2026-05-27** `52e5f37` — updated the mis reports page, added arcp claims and serial wise history page _[FEATURE]_
- **2026-05-27** `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_

### `scratch` (11 commits)

- **2026-05-18** `aac337f` — removed js scripts _[REFACTOR, SCHEMA / DB]_
- **2026-05-18** `e2665fe` — updated for performance _[FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI]_
- **2026-05-18** `f67ed4e` — updated layout and filterings and added profile setting and rbac page _[FEATURE, SCHEMA / DB, SECURITY, STYLE / UI]_
- **2026-05-15** `4f51d38` — now reports are verified for key mis and summary dashboard _[FEATURE]_
- **2026-05-15** `e9ff2ef` — testing for reports discrepencies _[FEATURE]_
- **2026-05-15** `49660ff` — excel export done _[FEATURE]_
- **2026-05-15** `44466b2` — excel export done _[CONFIG, FEATURE]_
- **2026-05-15** `180743a` — reports page made _[CONFIG, FEATURE]_
- **2026-05-15** `b461347` — reports page made _[DOCS, FEATURE, STYLE / UI]_
- **2026-05-14** `896eb75` — working something _[UNKNOWN]_
- **2026-05-14** `e7c5e1f` — first commit _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI]_

### `docs` (9 commits)

- **2026-05-29** `2ae99ca` — updated calls distribution for idle technicians _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-29** `c784558` — updated arcp claims data from jan 2025 till 28 may 26 _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-27** `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-20** `76f3b4b` — updated the calls _[DOCS]_
- **2026-05-20** `9eec406` — updated mis report to localstorage index the calls _[DOCS, FEATURE, PERFORMANCE, SCHEMA / DB]_
- **2026-05-19** `ec2a795` — added new page and worked on ensuring correct data is shown _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-15** `b461347` — reports page made _[DOCS, FEATURE, STYLE / UI]_
- **2026-05-14** `3bd5580` — resolved mobile issue and visits tab _[DOCS, FEATURE, FIX]_
- **2026-05-14** `e7c5e1f` — first commit _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI]_

### `src/contexts` (7 commits)

- **2026-05-29** `f1013f5` — removed crm mentionings _[REFACTOR]_
- **2026-05-29** `1ca8fee` — removed crm mentionings _[REFACTOR]_
- **2026-05-27** `2cc06f4` — phir wohi dukh _[SCHEMA / DB]_
- **2026-05-27** `36e28ae` — date range error _[FIX]_
- **2026-05-27** `4c6f9ed` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-27** `8744e6f` — trying to resolve speed _[PERFORMANCE]_
- **2026-05-26** `cb4e2b4` — implementing new dbs and calls _[UNKNOWN]_

### `src/app/admin` (7 commits)

- **2026-05-27** `35ef162` — removed vercel cron _[INFRA / DEVOPS, REFACTOR]_
- **2026-05-27** `bdd640c` — updated for cron jobs _[FEATURE, INFRA / DEVOPS]_
- **2026-05-22** `9c4b6ae` — let's check ui _[FEATURE, STYLE / UI]_
- **2026-05-18** `e2665fe` — updated for performance _[FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI]_
- **2026-05-18** `f67ed4e` — updated layout and filterings and added profile setting and rbac page _[FEATURE, SCHEMA / DB, SECURITY, STYLE / UI]_
- **2026-05-14** `3bd5580` — resolved mobile issue and visits tab _[DOCS, FEATURE, FIX]_
- **2026-05-14** `e7c5e1f` — first commit _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI]_

### `src/app/calls` (6 commits)

- **2026-05-22** `4a2187c` — shayad use ho? _[UNKNOWN]_
- **2026-05-21** `d40212f` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-21** `d97ed83` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-20** `c6d3ee4` — updated the calls _[UNKNOWN]_
- **2026-05-20** `92607c1` — updated the /calls page for fetchings _[FEATURE]_
- **2026-05-14** `3bd5580` — resolved mobile issue and visits tab _[DOCS, FEATURE, FIX]_

### `src/lib/db-proxy.ts` (5 commits)

- **2026-05-29** `f1013f5` — removed crm mentionings _[REFACTOR]_
- **2026-05-26** `cb4e2b4` — implementing new dbs and calls _[UNKNOWN]_
- **2026-05-21** `d97ed83` — worked on performance added local storage and reload technique _[PERFORMANCE]_
- **2026-05-20** `92607c1` — updated the /calls page for fetchings _[FEATURE]_
- **2026-05-15** `e9ff2ef` — testing for reports discrepencies _[FEATURE]_

### `scripts` (5 commits)

- **2026-05-29** `c784558` — updated arcp claims data from jan 2025 till 28 may 26 _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-27** `52e5f37` — updated the mis reports page, added arcp claims and serial wise history page _[FEATURE]_
- **2026-05-27** `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page _[CONFIG, DOCS, FEATURE, SCHEMA / DB]_
- **2026-05-25** `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs. _[FEATURE, STYLE / UI]_
- **2026-05-18** `aac337f` — removed js scripts _[REFACTOR, SCHEMA / DB]_

### `.gitignore` (4 commits)

- **2026-05-29** `2ae99ca` — updated calls distribution for idle technicians _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-25** `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs. _[FEATURE, STYLE / UI]_
- **2026-05-14** `896eb75` — working something _[UNKNOWN]_
- **2026-05-12** `24457c7` — Initial commit from Create Next App _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI]_

### `public` (4 commits)

- **2026-05-16** `e6c2256` — added middlewares and securities _[CONFIG, SECURITY]_
- **2026-05-15** `4f51d38` — now reports are verified for key mis and summary dashboard _[FEATURE]_
- **2026-05-15** `44466b2` — excel export done _[CONFIG, FEATURE]_
- **2026-05-12** `24457c7` — Initial commit from Create Next App _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI]_

### `package-lock.json` (3 commits)

- **2026-05-19** `ec2a795` — added new page and worked on ensuring correct data is shown _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-16** `e6c2256` — added middlewares and securities _[CONFIG, SECURITY]_
- **2026-05-15** `44466b2` — excel export done _[CONFIG, FEATURE]_

### `package.json` (3 commits)

- **2026-05-19** `ec2a795` — added new page and worked on ensuring correct data is shown _[CONFIG, DOCS, FEATURE, STYLE / UI]_
- **2026-05-16** `e6c2256` — added middlewares and securities _[CONFIG, SECURITY]_
- **2026-05-15** `44466b2` — excel export done _[CONFIG, FEATURE]_

### `src/lib/register-export-fetch.ts` (2 commits)

- **2026-05-29** `f1013f5` — removed crm mentionings _[REFACTOR]_
- **2026-05-27** `4c6f9ed` — trying to resolve speed _[PERFORMANCE]_

### `vercel.json` (2 commits)

- **2026-05-27** `35ef162` — removed vercel cron _[INFRA / DEVOPS, REFACTOR]_
- **2026-05-27** `bdd640c` — updated for cron jobs _[FEATURE, INFRA / DEVOPS]_

### `README.md` (2 commits)

- **2026-05-25** `6ea3e2b` — first commit _[DOCS, INITIAL / SETUP]_
- **2026-05-12** `24457c7` — Initial commit from Create Next App _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI]_

### `src/lib/register-csv-export.ts` (1 commits)

- **2026-05-27** `25031f0` — excel bug resolved _[FEATURE, FIX]_

### `src/lib/register-excel-export.ts` (1 commits)

- **2026-05-27** `25031f0` — excel bug resolved _[FEATURE, FIX]_

### `src/lib/report-corpus-storage.ts` (1 commits)

- **2026-05-27** `36e28ae` — date range error _[FIX]_

### `src/lib/report-filters.ts` (1 commits)

- **2026-05-27** `36e28ae` — date range error _[FIX]_

### `src/lib/report-register-view.ts` (1 commits)

- **2026-05-27** `8744e6f` — trying to resolve speed _[PERFORMANCE]_

### `src/lib/report-corpus.ts` (1 commits)

- **2026-05-26** `cb4e2b4` — implementing new dbs and calls _[UNKNOWN]_

### `.vscode` (1 commits)

- **2026-05-22** `9c4b6ae` — let's check ui _[FEATURE, STYLE / UI]_

### `scratch-test.js` (1 commits)

- **2026-05-22** `4a2187c` — shayad use ho? _[UNKNOWN]_

### `fix-drilldown.js` (1 commits)

- **2026-05-21** `c3eda74` — ab mai karunga saaf aur thik _[REFACTOR]_

### `scratch_count_check.js` (1 commits)

- **2026-05-19** `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors _[FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR]_

### `scratch_get_users.ts` (1 commits)

- **2026-05-19** `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors _[FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR]_

### `scratch_query.js` (1 commits)

- **2026-05-19** `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors _[FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR]_

### `test_counts.ts` (1 commits)

- **2026-05-19** `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors _[FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR]_

### `src/app/profile` (1 commits)

- **2026-05-18** `bb9a610` — deploying on vercel _[INFRA / DEVOPS]_

### `prisma` (1 commits)

- **2026-05-18** `f67ed4e` — updated layout and filterings and added profile setting and rbac page _[FEATURE, SCHEMA / DB, SECURITY, STYLE / UI]_

### `src/lib/supabase` (1 commits)

- **2026-05-16** `e6c2256` — added middlewares and securities _[CONFIG, SECURITY]_

### `test-dates.ts` (1 commits)

- **2026-05-15** `4f51d38` — now reports are verified for key mis and summary dashboard _[FEATURE]_

### `tsconfig.json` (1 commits)

- **2026-05-15** `180743a` — reports page made _[CONFIG, FEATURE]_

### `src/app/globals.css` (1 commits)

- **2026-05-15** `b461347` — reports page made _[DOCS, FEATURE, STYLE / UI]_

### `src/app/layout.tsx` (1 commits)

- **2026-05-14** `3bd5580` — resolved mobile issue and visits tab _[DOCS, FEATURE, FIX]_

### `check_major.js` (1 commits)

- **2026-05-14** `896eb75` — working something _[UNKNOWN]_

### `AGENTS.md` (1 commits)

- **2026-05-12** `24457c7` — Initial commit from Create Next App _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI]_

### `CLAUDE.md` (1 commits)

- **2026-05-12** `24457c7` — Initial commit from Create Next App _[CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI]_

---

## Complete Commit Log (reverse chronological)

#### `f1013f5` — removed crm mentionings
- **When:** 2026-05-29 13:46:35
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** HEAD -> main, origin/main
- **Category:** REFACTOR
- **Stats:** 6 files, +26/-164 lines
- **Purpose:** Remove CRM-specific terminology from user-facing copy and error messages.
  - **Modified (6):** `src/components/PostgresAutoSync.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/db-proxy.ts`, `src/lib/read-model/client-flags.ts`, `src/lib/register-export-fetch.ts`, `src/lib/user-facing-errors.ts`

#### `1ca8fee` — removed crm mentionings
- **When:** 2026-05-29 13:42:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR
- **Stats:** 22 files, +239/-235 lines
- **Purpose:** Remove CRM-specific terminology from user-facing copy and error messages.
  - **Added (1):** `src/lib/user-facing-errors.ts`
  - **Modified (21):** `src/app/api/distribution/route.ts`, `src/app/api/read-model/sync/route.ts`, `src/app/api/report/arcp-claims/detail/route.ts`, `src/app/api/report/arcp-claims/route.ts`, `src/app/api/report/corpus/route.ts`, `src/app/report/arcp-claims/page.tsx`, +15 more

#### `d1c0fff` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:29:06
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +9/-0 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Modified (1):** `src/lib/read-model/arcp/incremental.ts`

#### `7408f27` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:27:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +5/-4 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Modified (1):** `src/app/report/page.tsx`

#### `2ae99ca` — updated calls distribution for idle technicians
- **When:** 2026-05-29 12:23:55
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, STYLE / UI
- **Stats:** 25 files, +2061/-287 lines
- **Purpose:** Call distribution report: idle technician assignment logic and UI.
  - **Added (6):** `scripts/arcp-nightly.ps1`, `src/components/DistributionActiveFilters.tsx`, `src/components/DistributionTablePanel.tsx`, `src/lib/distribution-engineer-roster-cache.ts`, `src/lib/distribution-idle-assignees.ts`, `src/lib/read-model/arcp/coverage-query.ts`
  - **Modified (19):** `.gitignore`, `docs/sync.md`, `package.json`, `src/app/api/report/engineers/route.ts`, `src/app/globals.css`, `src/app/report/distribution/page.tsx`, +13 more

#### `c784558` — updated arcp claims data from jan 2025 till 28 may 26
- **When:** 2026-05-29 09:52:51
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, SCHEMA / DB
- **Stats:** 67 files, +5715/-571 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Added (34):** `docs/arcp-trends-overview.html`, `docs/read-model-phase1-schema/08-arcp_lines_hot.sql`, `docs/read-model-phase1-schema/09-arcp_bm_ho_approve_columns.sql`, `docs/sync.md`, `requirements-sync.txt`, `scripts/apply-read-model-schema.mjs`, `scripts/check-sync-status.ts`, `scripts/generate-arcp-trends-html.ts`, +26 more
  - **Modified (29):** `docs/read-model-cutover-checklist.md`, `docs/read-model-infra-gate.md`, `docs/read-model-phase1-schema/07-seed-sync-state.sql`, `package.json`, `src/app/admin/sync/page.tsx`, `src/app/api/read-model/sync/route.ts`, +23 more
  - **Deleted (4):** `src/app/api/read-model/cron/incremental/route.ts`, `src/app/api/read-model/cron/nightly/route.ts`, `src/app/api/read-model/cron/retention/route.ts`, `src/lib/read-model/cron-auth.ts`

#### `25031f0` — excel bug resolved
- **When:** 2026-05-27 16:32:47
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, FIX
- **Stats:** 6 files, +600/-268 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Added (1):** `src/lib/register-excel-export.ts`
  - **Modified (5):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/register-csv-export.ts`, `src/lib/register-export-fetch.ts`

#### `2cc06f4` — phir wohi dukh
- **When:** 2026-05-27 15:46:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** SCHEMA / DB
- **Stats:** 10 files, +361/-221 lines
- **Purpose:** Touches primarily: src/lib/read-model, src/app/api, src/app/report, src/components, src/contexts.
  - **Modified (10):** `src/app/api/read-model/sync/route.ts`, `src/app/report/page.tsx`, `src/components/DashboardLayout.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/auth.ts`, `src/lib/prisma.ts`, +4 more

#### `36e28ae` — date range error
- **When:** 2026-05-27 15:32:33
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FIX
- **Stats:** 5 files, +82/-19 lines
- **Purpose:** Touches primarily: src/app/report, src/components, src/contexts, src/lib/report-corpus-storage.ts, src/lib/report-filters.ts.
  - **Modified (5):** `src/app/report/page.tsx`, `src/components/DateRangeSelector.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/report-corpus-storage.ts`, `src/lib/report-filters.ts`

#### `4c6f9ed` — trying to resolve speed
- **When:** 2026-05-27 15:16:55
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 6 files, +367/-40 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/contexts, src/lib/read-model, src/lib/register-export-fetch.ts.
  - **Modified (6):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/register-export-fetch.ts`, `src/lib/report-corpus-storage.ts`

#### `8744e6f` — trying to resolve speed
- **When:** 2026-05-27 15:07:19
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 5 files, +252/-3 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/contexts, src/lib/read-model, src/lib/report-register-view.ts.
  - **Modified (5):** `src/app/api/report/route.ts`, `src/app/report/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/read-model/queries/register.ts`, `src/lib/report-register-view.ts`

#### `35ef162` — removed vercel cron
- **When:** 2026-05-27 14:57:39
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS, REFACTOR
- **Stats:** 2 files, +10/-24 lines
- **Purpose:** Cron job configuration for read-model sync (later removed from Vercel).
  - **Modified (1):** `src/app/admin/sync/page.tsx`
  - **Deleted (1):** `vercel.json`

#### `bdd640c` — updated for cron jobs
- **When:** 2026-05-27 14:51:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, INFRA / DEVOPS
- **Stats:** 6 files, +138/-2 lines
- **Purpose:** Cron job configuration for read-model sync (later removed from Vercel).
  - **Added (5):** `src/app/api/read-model/cron/incremental/route.ts`, `src/app/api/read-model/cron/nightly/route.ts`, `src/app/api/read-model/cron/retention/route.ts`, `src/lib/read-model/cron-auth.ts`, `vercel.json`
  - **Modified (1):** `src/app/admin/sync/page.tsx`

#### `52e5f37` — updated the mis reports page, added arcp claims and serial wise history page
- **When:** 2026-05-27 14:36:15
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 7 files, +16/-270 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Modified (3):** `scripts/verify-arcp-tally.ts`, `src/app/api/calls/[id]/route.ts`, `src/lib/read-model/backfill.ts`
  - **Deleted (4):** `scripts/apply-read-model-schema.mjs`, `scripts/check-read-model-locks.mjs`, `scripts/check-read-model-status.mjs`, `scripts/count-major-minor.mjs`

#### `18fe6c4` — updated the mis reports page, added arcp claims and serial wise history page
- **When:** 2026-05-27 14:24:07
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, SCHEMA / DB
- **Stats:** 79 files, +11387/-353 lines
- **Purpose:** ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.
  - **Added (61):** `docs/read-model-cutover-checklist.md`, `docs/read-model-infra-gate.md`, `docs/read-model-phase1-architecture.md`, `docs/read-model-phase1-schema.sql`, `docs/read-model-phase1-schema/01-extensions.sql`, `docs/read-model-phase1-schema/02-enums.sql`, `docs/read-model-phase1-schema/03-calls_latest_hot.sql`, `docs/read-model-phase1-schema/04-call_metrics_daily.sql`, +53 more
  - **Modified (18):** `package-lock.json`, `package.json`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/call-types/route.ts`, `src/app/api/report/corpus/route.ts`, +12 more

#### `cb4e2b4` — implementing new dbs and calls
- **When:** 2026-05-26 10:46:30
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 10 files, +1245/-429 lines
- **Purpose:** Touches primarily: src/app/report, src/app/api, src/contexts, src/lib/db-proxy.ts, src/lib/report-corpus.ts.
  - **Modified (10):** `src/app/api/report/corpus/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/app/report/serial-audit/page.tsx`, `src/contexts/ReportFiltersContext.tsx`, `src/lib/db-proxy.ts`, +4 more

#### `c006a81` — Add report corpus caching, register filter UI, and serial audit APIs.
- **When:** 2026-05-25 15:03:50
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, STYLE / UI
- **Stats:** 37 files, +5883/-1008 lines
- **Purpose:** Serial-wise history audit page and related APIs.
  - **Added (17):** `scripts/count-major-minor.mjs`, `src/app/api/report/corpus/route.ts`, `src/app/api/report/serial-audit/route.ts`, `src/components/RegisterActiveFilterChips.tsx`, `src/components/RegisterCompactToolbar.tsx`, `src/components/RegisterFilterDrawer.tsx`, `src/components/RegisterPageFilters.tsx`, `src/components/RegisterStatsBar.tsx`, +9 more
  - **Modified (20):** `.gitignore`, `src/app/api/distribution/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/globals.css`, +14 more

#### `6ea3e2b` — first commit
- **When:** 2026-05-25 14:59:45
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, INITIAL / SETUP
- **Stats:** 1 files, +1/-0 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Modified (1):** `README.md`

#### `9c4b6ae` — let's check ui
- **When:** 2026-05-22 16:50:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, STYLE / UI
- **Stats:** 39 files, +6118/-4614 lines
- **Purpose:** Touches primarily: src/components, src/app/api, src/app/report, src/app/admin, .vscode.
  - **Added (18):** `.vscode/settings.json`, `src/app/report/layout.tsx`, `src/app/report/serial-audit/page.tsx`, `src/components/PageShell.tsx`, `src/components/RegisterBranchFranchiseeFilters.tsx`, `src/components/RegisterColumnPicker.tsx`, `src/components/RegisterFilterBar.tsx`, `src/components/RegisterMultiSelect.tsx`, +10 more
  - **Modified (15):** `src/app/admin/page.tsx`, `src/app/admin/roles/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/api/distribution/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +9 more
  - **Deleted (6):** `src/app/api/calls/route.ts`, `src/app/calls/page.tsx`, `src/components/CallCard.tsx`, `src/components/CallTable.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`

#### `6c10254` — updated for branch manager to see proper view
- **When:** 2026-05-22 11:22:04
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 8 files, +87/-143 lines
- **Purpose:** Branch-manager scoped view and sidebar navigation.
  - **Modified (8):** `src/app/api/calls/route.ts`, `src/app/api/comments/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +2 more

#### `1f6803e` — updating sidebar
- **When:** 2026-05-22 10:56:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 6 files, +165/-218 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/components.
  - **Modified (6):** `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/components/Sidebar.tsx`

#### `4a2187c` — shayad use ho?
- **When:** 2026-05-22 10:31:49
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** tried-for-server-cache
- **Category:** UNKNOWN
- **Stats:** 19 files, +2165/-2091 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, src/components, scratch-test.js, src/app/calls.
  - **Added (6):** `scratch-test.js`, `src/lib/call-queries.ts`, `src/lib/global-cache.ts`, `test-query.js`, `test-query.ts`, `test-shared-data.js`
  - **Modified (13):** `src/app/api/calls/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, +7 more

#### `c3eda74` — ab mai karunga saaf aur thik
- **When:** 2026-05-21 13:50:33
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR
- **Stats:** 6 files, +97/-54 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report, fix-drilldown.js.
  - **Added (1):** `fix-drilldown.js`
  - **Modified (5):** `src/app/api/calls/[id]/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`

#### `d40212f` — worked on performance added local storage and reload technique
- **When:** 2026-05-21 11:04:28
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 1 files, +1/-5 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (1):** `src/app/calls/page.tsx`

#### `d97ed83` — worked on performance added local storage and reload technique
- **When:** 2026-05-21 11:01:09
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** PERFORMANCE
- **Stats:** 11 files, +1115/-505 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (11):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/calls/page.tsx`, `src/app/report/distribution/page.tsx`, `src/app/report/page.tsx`, `src/components/BranchTree.tsx`, +5 more

#### `76f3b4b` — updated the calls
- **When:** 2026-05-20 15:24:41
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS
- **Stats:** 1 files, +0/-2227 lines
- **Purpose:** Touches primarily: docs.
  - **Deleted (1):** `docs/db-sync-tool.html`

#### `c6d3ee4` — updated the calls
- **When:** 2026-05-20 15:23:44
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 1 files, +40/-9 lines
- **Purpose:** Touches primarily: src/app/calls.
  - **Modified (1):** `src/app/calls/page.tsx`

#### `92607c1` — updated the /calls page for fetchings
- **When:** 2026-05-20 15:18:05
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 10 files, +816/-666 lines
- **Purpose:** Touches primarily: src/app/api, src/components, src/app/calls, src/app/report, src/lib/db-proxy.ts.
  - **Modified (10):** `src/app/api/calls/[id]/route.ts`, `src/app/api/calls/route.ts`, `src/app/api/offices/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/calls/page.tsx`, +4 more

#### `9eec406` — updated mis report to localstorage index the calls
- **When:** 2026-05-20 12:49:57
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, PERFORMANCE, SCHEMA / DB
- **Stats:** 13 files, +154940/-728 lines
- **Purpose:** Touches primarily: src/app/api, docs, src/app/report.
  - **Added (6):** `docs/Manisha Sundar Pawar.pdf`, `docs/WesternCRM_Schema_Blueprint.sql`, `docs/db-sync-tool.html`, `docs/mstcity_backup.json`, `src/app/api/sync-proxy/[table]/route.ts`, `src/app/api/sync-proxy/sizes/route.ts`
  - **Modified (7):** `src/app/api/calls/route.ts`, `src/app/api/distribution/route.ts`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/distribution/page.tsx`, +1 more

#### `f3cc8d3` — removed tech solved column from summary dashboard and key account mis
- **When:** 2026-05-20 09:12:52
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, REFACTOR
- **Stats:** 1 files, +1/-11 lines
- **Purpose:** Touches primarily: src/app/report.
  - **Modified (1):** `src/app/report/page.tsx`

#### `930341a` — clean up scratch files and apply client-side performance optimizations to resolve vercel type errors
- **When:** 2026-05-19 16:55:22
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FIX, INFRA / DEVOPS, PERFORMANCE, REFACTOR
- **Stats:** 9 files, +107/-652 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Modified (1):** `src/app/report/distribution/page.tsx`
  - **Deleted (8):** `scratch_count_check.js`, `scratch_get_users.ts`, `scratch_query.js`, `src/app/report/distribution/analyze_csv.js`, `src/app/report/distribution/check_pincode_map.js`, `src/app/report/distribution/inspect.js`, `src/app/report/distribution/inspect.ts`, `test_counts.ts`

#### `ec2a795` — added new page and worked on ensuring correct data is shown
- **When:** 2026-05-19 16:46:53
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, STYLE / UI
- **Stats:** 20 files, +168345/-51 lines
- **Purpose:** Touches primarily: src/app/report, src/app/api, docs, package-lock.json, package.json.
  - **Added (10):** `docs/PincodMatrix.csv`, `scratch_get_users.ts`, `scratch_query.js`, `src/app/api/distribution/route.ts`, `src/app/report/distribution/analyze_csv.js`, `src/app/report/distribution/check_pincode_map.js`, `src/app/report/distribution/inspect.js`, `src/app/report/distribution/inspect.ts`, +2 more
  - **Modified (10):** `package-lock.json`, `package.json`, `src/app/api/report/drilldown/route.ts`, `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/globals.css`, +4 more

#### `2ae9e25` — deploying on vercel
- **When:** 2026-05-18 16:39:20
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS
- **Stats:** 1 files, +0/-3 lines
- **Purpose:** Vercel deployment configuration and type-error fixes.
  - **Deleted (1):** `src/app/api/temp-check/route.ts`

#### `bb9a610` — deploying on vercel
- **When:** 2026-05-18 16:36:38
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** INFRA / DEVOPS
- **Stats:** 3 files, +13/-81 lines
- **Purpose:** Vercel deployment configuration and type-error fixes.
  - **Modified (1):** `src/app/profile/page.tsx`
  - **Deleted (2):** `src/app/report/test_raw.ts`, `src/app/report/test_raw_month.ts`

#### `aac337f` — removed js scripts
- **When:** 2026-05-18 15:59:15
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** REFACTOR, SCHEMA / DB
- **Stats:** 19 files, +0/-1004 lines
- **Purpose:** Touches primarily: scratch, scripts.
  - **Deleted (19):** `scratch/add-avatar-column.js`, `scratch/add_avatar_column.js`, `scratch/check_constraint.js`, `scratch/check_rls.js`, `scratch/check_storage_policies.js`, `scratch/db_test.js`, `scratch/drop_constraint.js`, `scratch/fix_rls.js`, `scratch/inspect_mssql.js`, `scratch/inspect_mssql.ts`, `scratch/inspect_schema.ts`, `scratch/inspect_uv.ts`, `scratch/inspect_view_def.ts`, `scratch/migrate_roles.sql`, `scratch/run_migration.ts`, `scratch/setup_storage.js`, `scratch/test_db_queries.ts`, `scratch/view_def.sql`, `scripts/replace-typography.js`

#### `e2665fe` — updated for performance
- **When:** 2026-05-18 15:58:49
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, PERFORMANCE, SCHEMA / DB, STYLE / UI
- **Stats:** 43 files, +1939/-889 lines
- **Purpose:** Client-side caching via localStorage to reduce API load and improve page speed.
  - **Added (11):** `public/test_count.json`, `scratch/db_test.js`, `scratch/inspect_view_def.ts`, `scratch/view_def.sql`, `scratch_count_check.js`, `scripts/replace-typography.js`, `src/app/api/temp-check/route.ts`, `src/app/report/test_raw.ts`, +3 more
  - **Modified (28):** `scratch/inspect_uv.ts`, `src/app/admin/page.tsx`, `src/app/admin/roles/page.tsx`, `src/app/admin/users/page.tsx`, `src/app/api/calls/[id]/route.ts`, `src/app/api/calls/route.ts`, +22 more
  - **Deleted (4):** `test-dates.ts`, `test-dates2.ts`, `test-dates3.ts`, `test-dates4.ts`

#### `f67ed4e` — updated layout and filterings and added profile setting and rbac page
- **When:** 2026-05-18 10:51:31
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, SCHEMA / DB, SECURITY, STYLE / UI
- **Stats:** 44 files, +3271/-515 lines
- **Purpose:** RBAC admin page and user profile settings.
  - **Added (24):** `scratch/add-avatar-column.js`, `scratch/add_avatar_column.js`, `scratch/check_constraint.js`, `scratch/check_rls.js`, `scratch/check_storage_policies.js`, `scratch/drop_constraint.js`, `scratch/fix_rls.js`, `scratch/inspect_mssql.js`, +16 more
  - **Modified (19):** `prisma/schema.prisma`, `src/app/admin/users/page.tsx`, `src/app/api/admin/users/password/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/calls/route.ts`, `src/app/api/comments/route.ts`, +13 more
  - **Deleted (1):** `src/app/api/debug-columns/route.ts`

#### `e6c2256` — added middlewares and securities
- **When:** 2026-05-16 11:15:47
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, SECURITY
- **Stats:** 35 files, +629/-2705 lines
- **Purpose:** Auth middleware and security hardening.
  - **Added (4):** `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/server.ts`, `src/middleware.ts`
  - **Modified (20):** `package-lock.json`, `package.json`, `public/WRL_MIS_Report_2026-05-15 (1).xlsx`, `public/WRL_MIS_Report_2026-05-15.xlsx`, `src/app/admin/users/page.tsx`, `src/app/api/admin/users/password/route.ts`, +14 more
  - **Deleted (11):** `public/WRL_Detailed_Breakdown_2026-05-15 (1).xlsx`, `public/WRL_Detailed_Breakdown_2026-05-15.xlsx`, `public/WRL_MIS_Report_2026-05-15 (1).xls`, `public/WRL_MIS_Report_2026-05-15 (2).xls`, `public/WRL_MIS_Report_2026-05-15 (3).xls`, `public/WRL_MIS_Report_2026-05-15 (4).xls`, `public/WRL_MIS_Report_2026-05-15 (5).xls`, `public/WRL_MIS_Report_2026-05-15.csv`, `public/WRL_MIS_Report_2026-05-15.xls`, `public/~$WRL_MIS_Report_2026-05-15 (1).xlsx`, `src/lib/supabase.ts`

#### `3c40420` — updated branch search to have typeset also updated summary dashboard to show all counts not just breakdown
- **When:** 2026-05-15 15:36:07
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 3 files, +177/-16 lines
- **Purpose:** Touches primarily: src/app/api, src/app/report.
  - **Modified (3):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`

#### `4f51d38` — now reports are verified for key mis and summary dashboard
- **When:** 2026-05-15 15:13:13
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 17 files, +334/-309 lines
- **Purpose:** Touches primarily: public, scratch, src/app/api, src/app/report, test-dates.ts.
  - **Added (9):** `public/WRL_Detailed_Breakdown_2026-05-15 (1).xlsx`, `public/WRL_Detailed_Breakdown_2026-05-15.xlsx`, `public/WRL_MIS_Report_2026-05-15 (1).xlsx`, `public/WRL_MIS_Report_2026-05-15.csv`, `public/~$WRL_MIS_Report_2026-05-15 (1).xlsx`, `test-dates.ts`, `test-dates2.ts`, `test-dates3.ts`, +1 more
  - **Modified (3):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`
  - **Deleted (5):** `scratch/check_dupes.js`, `scratch/debug_summary.js`, `scratch/get_april_stats.js`, `scratch/get_summary.js`, `scratch/test_date_format.js`

#### `e9ff2ef` — testing for reports discrepencies
- **When:** 2026-05-15 14:03:05
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 12 files, +733/-119 lines
- **Purpose:** Touches primarily: scratch, src/app/api, src/app/report, src/lib/db-proxy.ts.
  - **Added (8):** `scratch/check_dupes.js`, `scratch/debug_summary.js`, `scratch/get_april_stats.js`, `scratch/get_summary.js`, `scratch/test_date_format.js`, `src/app/api/debug-columns/route.ts`, `src/app/api/report/call-types/route.ts`, `src/app/api/report/drilldown/route.ts`
  - **Modified (4):** `src/app/api/report/route.ts`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`, `src/lib/db-proxy.ts`

#### `49660ff` — excel export done
- **When:** 2026-05-15 12:26:12
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 2 files, +0/-70 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Deleted (2):** `scratch/check_mapping.ts`, `scratch/debug_mapping.js`

#### `44466b2` — excel export done
- **When:** 2026-05-15 12:25:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, FEATURE
- **Stats:** 13 files, +3784/-102 lines
- **Purpose:** Fix Excel export formatting/encoding bug in register reports.
  - **Added (9):** `public/WRL_MIS_Report_2026-05-15 (1).xls`, `public/WRL_MIS_Report_2026-05-15 (2).xls`, `public/WRL_MIS_Report_2026-05-15 (3).xls`, `public/WRL_MIS_Report_2026-05-15 (4).xls`, `public/WRL_MIS_Report_2026-05-15 (5).xls`, `public/WRL_MIS_Report_2026-05-15.xls`, `public/WRL_MIS_Report_2026-05-15.xlsx`, `scratch/check_mapping.ts`, +1 more
  - **Modified (4):** `package-lock.json`, `package.json`, `src/app/api/report/summary/route.ts`, `src/app/report/page.tsx`

#### `8fc0485` — reports page refresh once done
- **When:** 2026-05-15 11:44:26
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 1 files, +4/-7 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `src/app/report/page.tsx`

#### `22582d1` — reports page made
- **When:** 2026-05-15 11:39:32
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE
- **Stats:** 1 files, +1/-2 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `src/app/api/report/route.ts`

#### `180743a` — reports page made
- **When:** 2026-05-15 11:37:30
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, FEATURE
- **Stats:** 19 files, +1/-292 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Modified (1):** `tsconfig.json`
  - **Deleted (18):** `scratch/check_aa.js`, `scratch/check_hierarchy.js`, `scratch/check_hierarchy.ts`, `scratch/check_indore.js`, `scratch/check_lucknow.js`, `scratch/check_zones.js`, `scratch/find_serial_col.ts`, `scratch/find_statuses.js`, `scratch/find_statuses.ts`, `scratch/find_tables.ts`, `scratch/inspect_calltypes.ts`, `scratch/inspect_db.ts`, `scratch/inspect_party_profile.ts`, `scratch/inspect_partyprofile.ts`, `scratch/inspect_serialno.ts`, `scratch/inspect_serialno_party.ts`, `scratch/inspect_view.ts`, `scratch/inspect_view_all.ts`

#### `b461347` — reports page made
- **When:** 2026-05-15 11:35:46
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, STYLE / UI
- **Stats:** 30 files, +57867/-13 lines
- **Purpose:** Core MIS reports listing and refresh workflow.
  - **Added (24):** `docs/CRM_TableList.xlsb`, `docs/WesternCRM Schema Architect.txt`, `scratch/check_aa.js`, `scratch/check_hierarchy.js`, `scratch/check_hierarchy.ts`, `scratch/check_indore.js`, `scratch/check_lucknow.js`, `scratch/check_zones.js`, +16 more
  - **Modified (6):** `src/app/api/offices/route.ts`, `src/app/globals.css`, `src/components/CallDetail.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`, `src/lib/db-proxy.ts`

#### `3bd5580` — resolved mobile issue and visits tab
- **When:** 2026-05-14 16:06:22
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** DOCS, FEATURE, FIX
- **Stats:** 8 files, +389/-176 lines
- **Purpose:** Mobile layout fixes and visits tab behavior.
  - **Added (3):** `docs/BD & Deployment MIS.xlsx`, `docs/CRm Call Dashboard.docx`, `src/app/api/admin/users/password/route.ts`
  - **Modified (5):** `src/app/admin/users/page.tsx`, `src/app/api/calls/[id]/route.ts`, `src/app/calls/page.tsx`, `src/app/layout.tsx`, `src/components/CallDetail.tsx`

#### `e76f752` — resolved mobile issue and visits tab
- **When:** 2026-05-14 16:06:16
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** FEATURE, FIX
- **Stats:** 4 files, +54/-18 lines
- **Purpose:** Mobile layout fixes and visits tab behavior.
  - **Modified (4):** `src/app/api/calls/[id]/route.ts`, `src/components/CallDetail.tsx`, `src/components/DesktopView.tsx`, `src/components/MobileView.tsx`

#### `896eb75` — working something
- **When:** 2026-05-14 15:16:23
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** UNKNOWN
- **Stats:** 34 files, +281/-1162 lines
- **Purpose:** Touches primarily: scratch, src/app/api, src/components, .gitignore, check_major.js.
  - **Added (1):** `public/western-head-logo-2025.png`
  - **Modified (9):** `.gitignore`, `src/app/admin/users/page.tsx`, `src/app/api/admin/clear-cache/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/login/page.tsx`, `src/components/CallDetail.tsx`, +3 more
  - **Deleted (24):** `check_major.js`, `scratch/add_started_at.ts`, `scratch/check_cache.js`, `scratch/check_cache.ts`, `scratch/check_cols.js`, `scratch/check_count.js`, `scratch/check_reasons.ts`, `scratch/check_users_schema.ts`, `scratch/diagnose_db.ts`, `scratch/find_reasons.ts`, `scratch/fix_schemas.ts`, `scratch/list_tables.ts`, `scratch/migrate.js`, `scratch/migrate_started_at.ts`, `scratch/purge_cache.js`, `scratch/setup_cache_table.ts`, `scratch/test_items.ts`, `scratch/test_join.ts`, `scratch/test_join_internal.ts`, `scratch/test_link.js`, `scratch/verify_cancel_reason.ts`, `scratch/verify_linkage.ts`, `src/app/api/debug-parts/route.ts`, `ticket_detail_modal.html`

#### `e7c5e1f` — first commit
- **When:** 2026-05-14 15:14:58
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, INITIAL / SETUP, SCHEMA / DB, STYLE / UI
- **Stats:** 66 files, +12752/-140 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Added (59):** `check_major.js`, `docs/BRD_FSD_content.txt`, `docs/SUPABASE_SETUP.md`, `docs/WRL_BRD_FSD_v1.1.docx`, `docs/sourcecodecallview.txt`, `prisma.config.ts`, `prisma/schema.prisma`, `scratch/add_started_at.ts`, +51 more
  - **Modified (7):** `.gitignore`, `README.md`, `package-lock.json`, `package.json`, `src/app/globals.css`, `src/app/layout.tsx`, +1 more

#### `24457c7` — Initial commit from Create Next App
- **When:** 2026-05-12 11:30:24
- **Author:** VV <vishun.orv@gmail.com>
- **Branch/Tag:** _main line_
- **Category:** CONFIG, DOCS, FEATURE, INITIAL / SETUP, STYLE / UI
- **Stats:** 19 files, +6997/-0 lines
- **Purpose:** Project bootstrap — Next.js app scaffold.
  - **Added (19):** `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `eslint.config.mjs`, `next.config.ts`, `package-lock.json`, `package.json`, +11 more

---

## Appendix: Raw Data Files

Extracted during audit (Phase 1):

| File | Description |
|------|-------------|
| `docs/git-audit/git_full_log.txt` | Full commit log with graph |
| `docs/git-audit/git_detailed_log.txt` | Per-commit file change list |
| `docs/git-audit/git_stat_log.txt` | Diff stats per commit |
| `docs/git-audit/git_branches.txt` | Branch tips |
| `docs/git-audit/git_tags.txt` | Tags (empty) |
| `docs/git-audit/git_remote_log.txt` | Remote-tracking history |
| `docs/git-audit/git_contributors.txt` | Contributor summary |

---

*Document auto-generated by `scripts/generate-changelog-from-git.mjs`*
