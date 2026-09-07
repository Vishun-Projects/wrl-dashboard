# Git and release

Generated: 2026-09-07

## Repository

```
origin	https://github.com/Vishun-Projects/wrl-dashboard.git (fetch)
origin	https://github.com/Vishun-Projects/wrl-dashboard.git (push)
```

- **Default branch:** main
- **Package:** fast-close-app@0.1.0
- **Describe:** b56e11b

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
b56e11b Tighten spare loan check layout: table scroll and denser filters.
df5b182 Fix spare loan ZIP Blob typing for TypeScript push checks.
781d63c Enrich spare loan check with plant name, zone, and safer CSV exports.
e252f0e Keep nodemailer out of the report UI client bundle.
2887e5b Fix midnight verify false fails from nengineer string vs number.
adde845 Harden CRM 405 handling and gate morning MIS on midnight verify.
7cbe452 Gzip spare loan HTML uploads so large files clear Vercel payload limits.
d02f58e Fix spare loan item category: live CRM fallback and backfill on load.
75ecd57 Add spare loan search by call number/barcode and show barcode column.
f825a99 Distinguish unassigned cancelled calls and add call-logged date presets.
5f9b091 Map spare loan materials to CRM item category and filter by it.
436c1cc Enrich spare loan check with filters, CRM dates, and clearer vendor mismatch UI.
79921b6 there was error while processing excel - resolved it
ee1ce88 will save in database too the successfully processed data
5397603 Add ZSS02 spare loan HTML check for vendor/SO mismatches.
68d1d0d Drop unused open-export filter import so pre-push lint passes.
f96b1e6 Fix MIS digest body to match yesterday's CRM totals plus open-calls Excel.
a1b6110 Add cancelled calls assignment filter and handover documentation pack.
553fcb7 fix: remove unused ARCP filter apply leftovers after instant apply
bbaab32 fix: keep Postgres MIS align off client barrel exports
```
