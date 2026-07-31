# UI patterns

## Filter apply model (tiered)

| Tier | Pages | Behavior |
|------|-------|----------|
| A — Client | Warranty Master | Filters apply instantly (no server round-trip) |
| B — Expensive | ARCP Claims, Location Audit | Explicit **Apply** / **Run audit** |
| C — Shared context | Register, Distribution, Serial Audit | `applyFilters()` bumps `appliedRevision`; one `useEffect` loads data |

**Do not** call fetch in `onApply` when the page already listens to `appliedRevision`.

## Perceived performance

Respond within **~400ms (Doherty threshold)** on every user action. Use shared primitives from `@/components/report/ReportLoadingFeedback`, `@/components/ui/ReportLoadBanner`, and `@/components/ui/DataTableLoading`.

| Law | Rule | Anti-pattern |
|-----|------|--------------|
| **Doherty (~400ms)** | Immediate feedback: button spinner, progress bar, or optimistic status | Blank screen; disabled UI with no indicator |
| **Stale-while-revalidate** | `loading` = no data (skeleton); `updating` = keep rows + progress bar/overlay | Clearing table on refetch; full-page block when cache exists |
| **Feedback hierarchy** | Progress → banner or `ReportFetchingBar`; errors → `PageAlert`; success → `feedback.actionSuccess` | Toasts for in-progress loads |
| **Race safety** | `loadGenerationRef` + `AbortController` + `isStale()` (per page / feature) | Stale responses overwriting newer filters |
| **Hick's Law** | Equal-weight stats (see below) | Hero metrics or collapsed sub-stats |
| **Fitts's Law** | Page shell stays visible; progress inline | Entire page replaced by spinner |

```text
User action → instant feedback (<400ms)
  → no visible data? skeleton (loading)
  → has data? keep data + ReportFetchingBar (updating)
  → fetch → merge → clear progress, keep data
```

## Stats strip policy

The MIS register stats bar (`RegisterStatsBar`) keeps **all metrics equal-weight**:

- Total, Solved (with **Tech. Solve Call** + **Closed**), Open (with **Open Unallocated** + **Assigned**), Cancelled
- No Hick's Law hero metric or collapsed sub-stats

## Serial numbers and IDs

Show **verbatim** database values. Layout may truncate with CSS; `title` and export/search use the raw string. No chunking, spacing, or display transforms.

## Feedback (toast vs banner)

Use `@/lib/ui/feedback` for action toasts. Use `PageAlert` for page-level load errors. See `src/lib/ui/feedback.ts` header.

## Glossary terms

| Term | Meaning |
|------|---------|
| ARCP | Approved claim lines from CRM |
| BM | Branch Manager approval stage |
| ASP | Authorized Service Partner / franchisee |
| HOD | Head of Department (HO approval) |
| FRN | Franchisee code |

Use `GlossaryTerm` from `@/components/ui/GlossaryTerm`.

## Table scrollport (fixed viewport)

The dashboard shell is `h-screen overflow-hidden`. Each data page must wire:

1. `PageShell` body — `overflow-hidden`, filters/stats as `shrink-0`
2. Table region — `flex min-h-0 flex-1 flex-col overflow-hidden`
3. Scrollport — `min-h-0 flex-1 overflow-auto` (`AdminTableCard`, `register-table-wrap`, or `distribution-table-panel__body`)

Do **not** move vertical scroll to the page body unless the page is a stacked dashboard (e.g. Sync). Horizontal overflow stays inside the scrollport; use `HorizontalScrollFade` only where wide columns need a right-edge fade.

## Confirm dialogs

Use `ConfirmDialog` from `@/components/ui/ConfirmDialog` for destructive actions (delete user/role). Do not use native `confirm()`.

All modals must render via `ModalPortal` (portaled to `document.body`) with `ModalBackdrop` (`bg-slate-900/40 backdrop-blur-sm`) so the **sidebar and main content** dim together — same as Call Detail.

## ARCP session restore

On ARCP visit, if a prior load job exists (`load-status?latest=any`) **and restored filters match the current draft**, the page silently hydrates partial aggregates and resumes the job. If filters differ, the stale job is ignored.

## Manual regression checklist

1. Stats strip: all numbers visible; Tech Solve + Closed clickable
2. Register: Status after Customer (new default columns); serial verbatim; scroll fade; no blank white mount flash
3. Distribution / Serial: single fetch per apply (network tab); refetch keeps prior table visible with progress bar
4. Warranty: instant filters; customer name on every row; expanded FG breakdown full width; refresh shows progress bar not full table wipe
5. ARCP: Apply gating unchanged; preview banner on long ranges; table scrolls inside card; session restore when filters match
6. Serial Audit: one register link in expanded detail only; filter revision keeps list visible while updating
7. Distribution: no per-row register link; panel tables scroll; KPIs stay visible during filter refresh
8. Location Audit: Run audit shows staged progress; CSV export shows in-button progress; stats stay during reload
9. Admin Users/Roles/Profile: skeleton in content area, not full-page white spinner
10. Admin delete: custom `ConfirmDialog`, not browser confirm
11. Register: table scrolls inside pane; pagination below table; horizontal fade when columns overflow
12. Orientation banner: dismissible per session
13. Speed: every Apply/Refresh/Run shows feedback within 400ms; no duplicate full-page + in-content spinners
