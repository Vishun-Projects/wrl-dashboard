# Git and release

Generated: 2026-09-02

## Repository

```
origin	https://github.com/Vishun-Projects/wrl-dashboard.git (fetch)
origin	https://github.com/Vishun-Projects/wrl-dashboard.git (push)
```

- **Default branch:** main
- **Package:** fast-close-app@0.1.0
- **Describe:** 4cd6dee

## Production

- **App URL:** https://wrl-dashboard.vercel.app (Vercel)
- **VPS workers:** `scripts/vps-hosting/` (rsync + systemd + cron)

## Key npm scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Production build |
| `npm run handover:export` | Regenerate this handover pack |
| `npm run mis-email:*` | MIS mail ops |
| `sync-worker:*` | Read-model sync (see SYNC_ENTRY_POINTS.md) |

## Branch policy

Feature branches → pull request → `main`. Deploy follows Vercel + VPS rsync.

## Recent commits

```
4cd6dee updated the date range filter in cancelled calls ui
50e7734 optimized the performance
72257fc perf: speed up cancelled calls with denormalized columns and indexes
c987e20 fix: add item_code to HotRow test fixtures and DB normalizer
2e221bb fix: raise open-count parity Excel test timeout under full suite load
e5117f1 updated cancelled calls page with additional filters
71f7ac3 Remove obsolete script shims, stale docs, and unused quality tooling.
de3718b Prune dead deps, relocate Athena/sync routes, and add module guardrails.
35d124d updated for ui sync button
9decfab updated for ui sync button
b67b0f3 updated show sorting of dates in athena
c2ea02c solved query for cancelled calls - to reflect names instead of id
2182375 Add Postgres-only cancelled register sync and refine Athena reconciliation.
a12c6e5 Remove Multiple CRM Matches KPI from Athena reconciliation UI.
423a720 Fix Aug 25 registered count: allow single 4-way match without CCLID
e4d5bf7 Only flag Multiple CRM Matches for true same-CCLID duplicates.
e30b6bb Remove dead chart code from Athena analytics component.
fc3d778 Revert "Restore Athena trend analytics expanded view removed by accident."
18481c7 Restore Athena trend analytics expanded view removed by accident.
9b0050d Fix vitest root config when parent tsconfig is empty.
```
