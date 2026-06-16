# Sync (CRM → Postgres)

## Continuous sync (recommended for local / dedicated host)

Run the daemon in a terminal (calls + ARCP incremental on an interval):

```bash
npm run sync-worker:daemon
```

Defaults: every `SYNC_INTERVAL_MS` (180000 ms). Requires:

```bash
SYNC_WORKER_ENABLED=true
SYNC_ARCP_ENABLED=true   # optional, for ARCP in the same loop
DATABASE_URL=postgresql://...@api.wrl-fsm.cloud:5432/postgres   # direct :5432 (not pooler)
```

**Network prerequisites (local daemon):**

- **`westerncrm.com`** must resolve — sync reads CRM via the Western CRM DBQUERY proxy.
- **`DATABASE_URL` host** must resolve — use direct Postgres `:5432` (bootstrap sets `USE_DIRECT_DATABASE=true`).
- After downtime, incremental runs in **catch-up mode** (1-day windows, 8 ncode shards/day by default, 1.5s gap between CRM posts). Uses a **lightweight sync query** (no ARCP/visit/repair subqueries per row — report corpus API is unchanged).
- If catch-up keeps failing (CRM timeout / `ENOTFOUND`), fix network/VPN to `westerncrm.com` first. Tune `SYNC_CRM_CATCHUP_CHUNK_DAYS=1`, `SYNC_CRM_NCODE_SHARD_INITIAL=16` if needed.

The browser **does not** auto-sync anymore (`PostgresAutoSync` was removed). Use the daemon, nightly jobs, or manual sync below.

## Manual / admin sync

- **Admin → Sync** (`/admin/sync`) — status and `POST /api/read-model/sync`
- Report pages may trigger sync via the same API when wired in UI

## Nightly (Task Scheduler / cron)

```bash
npm run sync-worker:arcp-nightly   # ARCP incremental only
npm run sync-worker:nightly        # calls reconcile + ARCP when SYNC_ARCP_ENABLED=true
```

## One-time backfill

```bash
npm run sync-worker:backfill
npm run sync-worker:arcp-backfill   # restart-safe; use arcp-reset for a clean slate
```

See `package.json` for all `sync-worker:*` commands.

## Environment reference

| Variable | Purpose |
|----------|---------|
| `SYNC_WORKER_ENABLED` | Must be `true` for worker commands |
| `SYNC_ARCP_ENABLED` | ARCP in daemon / nightly / API sync |
| `SYNC_INTERVAL_MS` | Daemon interval (default 180000) |
| `SYNC_CRM_INCREMENTAL_CHUNK_DAYS` | CRM window for short catch-up (default 1) |
| `SYNC_CRM_CATCHUP_CHUNK_DAYS` | CRM window when catch-up > 3 days (default 1) |
| `SYNC_CRM_INCREMENTAL_TIMEOUT_MS` | HTTP timeout per CRM chunk (default 300000) |
| `SYNC_CRM_HOUR_CHUNK_SIZE` | Hours per sub-window when a day times out (default 6) |
| `SYNC_CRM_FETCH_GAP_MS` | Pause between CRM POSTs (default 1500) |
| `SYNC_CRM_NCODE_SHARD_INITIAL` | ncode shards per day (default 8; ARCP uses 16 on a simpler table) |
| `SYNC_CRM_NCODE_SHARD_MAX` | Max ncode shard splits (default 32) |
| `SYNC_CRM_SHARD_FIRST` | Shard single-day windows immediately (default true) |
| `SYNC_STALE_LOCK_MS` | Clear stuck `sync_state.is_running` (default 5 min) |
| `DATABASE_URL` | Postgres; worker prefers direct `:5432` |

## Performance notes

- One sync worker instance at a time (`sync_state` + advisory locks).
- CRM reads use chunked date windows and row caps — see `read-model` docs.
- App report APIs read from Postgres hot tables when flags are enabled (`READ_*_FROM=postgres`).
