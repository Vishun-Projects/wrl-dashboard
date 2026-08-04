# Sync module

## Why this exists

Portal ops need **read-model health** and **VPS cron pause/resume** from the UI. The actual sync worker must **not** run over HTTP — that stays CLI / `@/lib/read-model` (and ARCP/mail workers under their modules).

```text
Admin sync page / report UI  →  GET read-model-status  →  getReadModelProgress()
Super Admin VPS cron UI      →  GET/PATCH vps-cron     →  @/lib/vps-cron settings
CLI / worker hosts           →  honor pause via cli-gate (not these routes)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Incremental / nightly / TE / locks | `@/lib/read-model/*` |
| ARCP sync workers | `@/modules/arcp-claims/server/sync/*` |
| Mail digest / major-repair workers | `@/modules/mis-email/server/sync/*` |
| Cron catalog + pause storage | `@/lib/vps-cron/*` |
| Admin sync / VPS cron pages | `src/app/admin/sync`, `src/app/admin/vps-cron` (thin) |

## Layout

```text
server/routes/
  read-model-status.ts
  vps-cron.ts
```

---

## Core flows

1. Report reader or `manage_users` hits status → `getReadModelProgress()`.
2. Super Admin opens VPS cron → list job pause state from catalog + settings.
3. PATCH pause/resume → `setVpsCronPaused` + security audit.
4. Cron hosts honor pause via `@/lib/vps-cron` when jobs start (bash cli-gate).

---

## Invariants (easy to break)

1. Status GET: **report-page access or `manage_users`** — not public.
2. VPS cron GET/PATCH: **`super_admin` only** (`canManageVpsCron`); PATCH same-origin.
3. `jobId` must be in catalog (`isVpsCronJobId`) — unknown ids rejected.
4. Pausing here only flips settings the CLI gate respects — it does **not** stop an in-flight HTTP sync (there isn’t one).
5. Do **not** add “run sync now” to these routes without a deliberate design change (locks, CRM load, Vercel timeouts).
6. Settings cache is short (~10s) so bash cli-gate sees portal pause flips without hammering Postgres.

---

## Where to look

| Need | Place |
|------|--------|
| Sync progress API | `server/routes/read-model-status.ts` |
| Pause/list cron | `server/routes/vps-cron.ts` |
| Catalog / settings | `@/lib/vps-cron/catalog.ts`, `settings.ts` |
| Actual sync | `@/lib/read-model/cli.ts`, `incremental.ts`, `nightly.ts`, … |

## When you change something

| Change | Also check |
|--------|------------|
| New cron job | `vps-cron/catalog`, CLI gate, admin UI |
| Progress shape | Admin sync page + performance snapshot |
| Access rules | `rbac-catalog` paths for sync / vps-cron |
| Temptation to “trigger sync from API” | Prefer CLI + lock; document why HTTP is refused |
