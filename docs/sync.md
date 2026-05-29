# Sync (CRM → Postgres)

## Live sync (local + Vercel)

While a user is logged in, the app runs **automatic incremental sync** every 3 minutes (configurable):

- Component: `src/components/PostgresAutoSync.tsx`
- API: `POST /api/read-model/sync` (calls + ARCP when `SYNC_ARCP_ENABLED=true`)

No Vercel Cron, no background daemon required.

**Env:**

```bash
SYNC_WORKER_ENABLED=true
SYNC_ARCP_ENABLED=true
NEXT_PUBLIC_AUTO_SYNC_INTERVAL_MS=180000   # optional, min 60000
NEXT_PUBLIC_AUTO_SYNC_ENABLED=false        # set to disable browser auto-sync
```

**Note:** CRM→Postgres only runs while someone has the app open. Overnight updates require a user session the next day, or a manual Sync click on report pages.

## One-time backfill (terminal)

Run once per environment until Admin → Sync shows Ready:

```bash
npm run sync-worker:arcp-reset          # wipe ARCP hot table (only way to start truly fresh)
npm run sync-worker:backfill
npm run sync-worker:arcp-backfill       # restart-safe: keeps existing rows, resumes by MAX(call_at)
```

ARCP backfill: set `ARCP_BACKFILL_START_DATE=2025-01-01` to skip 2024 and save space. **Restarting** `arcp-backfill` does **not** truncate — it auto-resumes. To wipe data: `npm run sync-worker:arcp-reset`, Supabase truncate, or `ARCP_BACKFILL_FORCE_RESET=true`. Defaults: 1-day CRM windows, 16 ncode shards per day.

After pulling BM/HO column changes, run `npm run db:apply-read-model` once (applies `09-arcp_bm_ho_approve_columns.sql`), then `npm run sync-worker:arcp-reset` and `npm run sync-worker:arcp-backfill`.

Python wrapper (optional): `python scripts/sync_worker.py arcp-backfill`

## Manual sync (report UI)

The Sync button on register/report pages runs the same API and reloads report data from Postgres.
