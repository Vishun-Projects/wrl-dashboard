# Auto change log (push notify)

Appended by `scripts/quality/notify-push-change-log.mjs` on each main push.

## 2026-08-27T10:51:50+05:30 — `5db587e`

- **Platform:** Git+Vercel+VPS
- **What changed:** Add cancelled-call digests, attendance activity report, and midnight CRM delta. (+5 more)
- **Why:** git push notify (auto)
- **What affected:** src/lib/read-model, src/modules/mis-email, scripts/vps-hosting, src/modules/mis, src/modules/subcontractor-stock, docs
- **Criticality:** HIGH
- **Impact / risks:** Read-model / sync-worker code changed — if VPS release is stale, daemon can crash-loop (missing module). HIGH criticality paths/messages — re-test auth/reports/sync after deploy.
- **Overlooked:** Vercel: push to main auto-deploys wrl-dashboard. Confirm deploy Ready (not Error) before trusting UI. VPS: not auto-updated by git push. Run sync-worker deploy (npm run sync-worker:deploy:vps) if workers/SQL changed — or sync-worker can crash (missing modules). Vercel check: VERCEL_TOKEN not set — skipped deploy check
- **Vercel:** VERCEL_TOKEN not set — skipped deploy check
## 2026-08-27T11:06:47+05:30 — `8016bc2`

- **Platform:** Git+Vercel
- **What changed:** Fix Vercel build: export mergeBranchPerformanceRowsByName for digest compose.
- **Why:** git push notify (auto)
- **What affected:** src/modules/mis-email, .gitignore
- **Criticality:** MED
- **Impact / risks:** no evidence of breakage in this push range
- **Overlooked:** Vercel: push to main auto-deploys wrl-dashboard. Confirm deploy Ready (not Error) before trusting UI. Vercel check: VERCEL_TOKEN not set — skipped deploy check
- **Vercel:** VERCEL_TOKEN not set — skipped deploy check
