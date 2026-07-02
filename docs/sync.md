# Sync (CRM → Postgres)

## Continuous sync (recommended for local / dedicated host)

Run the daemon in a terminal (calls + ARCP incremental on an interval):

```bash
npm run sync-worker:daemon
```

Defaults: every `SYNC_INTERVAL_MS` (180000 ms). Each run:

1. **Editedon delta** — `ISNULL(editedon, addedon) >= watermark`; each fetched row is **fully upserted** into `calls_latest_hot` (status + all mapped fields).
2. **Pipeline reconcile** — re-checks open/assigned hot rows against live CRM by TRN.
3. **Editedon day catch-up** — one calendar day of `editedon BETWEEN day..day AND addedon <> editedon` (rotating YTD replay for missed status changes).

Requires:

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

## Production sync model (MIS / dashboard)

**Use incremental `editedon` sync only** — the 3-minute VPS daemon (`fast-close-sync-worker`):

1. **`editedon >= watermark`** — pulls CRM rows changed since last sync (edits on `editedon` when `addedon <> editedon`).
2. **Pipeline reconcile** — open/assigned TRNs re-checked by ID when hot row is stale vs CRM.
3. **Editedon day catch-up** — replays `editedon` calendar days with `addedon <> editedon` (fixes rows already behind the watermark).

This is what produced **~8,774 open** aligned with Excel **8,773** before any bulk jobs ran: hot table + editedon deltas, not a full-table refresh.

**Do not use for routine MIS close:**

| Command | Why not |
|---------|---------|
| `fill-ytd` | Re-upserts **entire YTD** from live CRM — overwrites every status in one shot |
| `restore-hot-status-from-csv.ts` without the frozen register | Only run against the **same** `CRM_WRL_MIS_Register_*.csv` export used for Excel; restores **status only** for snapshot TRNs (not region) |

If a mistaken `fill-ytd` ran:

1. Prefer a **database backup from before that run**.
2. Otherwise run `npx tsx scripts/mis-client/restore-hot-status-from-csv.ts [path-to-register-csv]` — restores **status** from the frozen export.
3. If `region` is blank on some rows, run `npx tsx scripts/mis-client/fix-hot-region-from-office.ts` — backfills from `dim_offices` zone (same as live CRM). Register/export queries also resolve blank `h.region` via office zone fallback.

**BD MIS regional totals** use resolved region: stored `h.region`, or office zone when blank (matches CRM register export). Not `mis_plant_region_mappings`.

Keep `fast-close-sync-worker-nightly.timer` **disabled** on VPS during MIS close.

## Nightly (optional — not for MIS close weeks)

```bash
npm run sync-worker:arcp-nightly   # ARCP incremental only
npm run sync-worker:nightly        # YTD editedon catch-up + pipeline reconcile (+ ARCP when enabled)
npm run sync-worker:editedon-catchup -- --from 2026-06-30 --to 2026-06-30
npm run sync-worker:fill-ytd       # YTD hot upsert (no truncate) — gap-fill only; avoid during Excel tally
```

`setup-sync-worker-daemon.sh` can install a **02:30 daily timer** for `fill-ytd`. Leave it **disabled** while reconciling to BD MIS Excel.

`fill-ytd` needs `NODE_OPTIONS=--max-old-space-size=4096` on an 8GB VPS. If nightly log shows `heap out of memory`, increase to `6144` or tune `SYNC_BACKFILL_CHUNK_DAYS`.

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
| `SYNC_PIPELINE_RECONCILE_ENABLED` | Re-check open/assigned hot rows each incremental (default on) |
| `SYNC_PIPELINE_RECONCILE_BATCH` | Pipeline TRNs checked per incremental run (default 400) |
| `SYNC_EDITEDON_CATCHUP_ENABLED` | Replay editedon day windows each incremental (default on) |
| `SYNC_EDITEDON_CATCHUP_DAYS_PER_RUN` | Calendar days per incremental catch-up step (default 1) |
| `SYNC_EDITEDON_CATCHUP_FROM` | YTD start for nightly editedon catch-up (default Jan 1) |
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
