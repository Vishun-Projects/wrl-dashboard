# UI patterns

## Filter apply model (tiered)

| Tier | Pages | Behavior |
|------|-------|----------|
| A — Client | Warranty Master | Filters apply instantly (no server round-trip) |
| B — Expensive | ARCP Claims, Location Audit | Explicit **Apply** / **Run audit** |
| C — Shared context | Register, Distribution, Serial Audit | `applyFilters()` bumps `appliedRevision`; one `useEffect` loads data |

**Do not** call fetch in `onApply` when the page already listens to `appliedRevision`.

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

On every ARCP visit, if a prior load job exists (`load-status?latest=any`), show `ArcpRestoreSessionDialog` before loading data. User chooses **Continue previous session** or **Start fresh**. Never auto-start `runLoad` silently. ARCP date basis is persisted in `report_preferences.arcp.dateFilterColumn`.

## Manual regression checklist

1. Stats strip: all numbers visible; Tech Solve + Closed clickable
2. Register: Status after Customer (new default columns); serial verbatim; scroll fade
3. Distribution / Serial: single fetch per apply (network tab)
4. Warranty: instant filters; customer name on every row; expanded FG breakdown full width (no horizontal scroll)
5. ARCP: restore modal on revisit; Apply gating unchanged; table scrolls inside card
6. Serial Audit: one register link in expanded detail only
7. Distribution: no per-row register link; panel tables scroll
8. Admin delete: custom `ConfirmDialog`, not browser confirm
9. Register: table scrolls inside pane; pagination below table; horizontal fade when columns overflow
10. Orientation banner: dismissible per session
