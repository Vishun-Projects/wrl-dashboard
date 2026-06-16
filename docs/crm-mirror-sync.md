# CRM full mirror (`old_crm`)

Python pipeline that mirrors **all Western CRM tables** into Postgres database **`old_crm`** on the VPS. Independent of the app read-model sync worker (`calls_latest_hot`, etc.).

## Prerequisites

1. **Create database** on VPS (once):

```bash
ssh root@187.127.145.253
docker exec -it supabase-db psql -U postgres -c "CREATE DATABASE old_crm;"
```

2. **Apply schema**:

```bash
OLD_CRM_DATABASE_URL=postgresql://postgres.ddmapuyghfeoyajxbcjh:PASSWORD@api.wrl-fsm.cloud:6543/old_crm?pgbouncer=true \
  node scripts/apply-old-crm-schema.mjs
```

3. **Python deps**:

```bash
pip install -r requirements-crm-mirror.txt
```

4. **Env** (`.env.local`):

```bash
OLD_CRM_DATABASE_URL=postgresql://postgres.ddmapuyghfeoyajxbcjh:PASSWORD@api.wrl-fsm.cloud:6543/old_crm?pgbouncer=true
CRM_MIRROR_FETCH_GAP_MS=1200
CRM_MIRROR_PAGE_SIZE=200
CRM_MIRROR_OVERLAP_MINUTES=2
```

Use **tenant pooler** (`postgres.PROJECT_REF` on port **6543**). Plain `postgres@5432` from outside the VPS returns Supavisor “no tenant identifier” errors.

## Phases (per table)

| Phase | Command | Description |
|-------|---------|-------------|
| 1 | `init-catalog` | Discover all CRM tables, create `crm_raw.*` DDL + `sync_state` |
| 2 | `backfill` | Full keyset copy with cursor sealing |
| 3 | `catchup` | Replay CRM changes during backfill (2 empty passes required) |
| 4 | `verify` | **Mandatory** — 5 exactness gates; blocks `live` on failure |
| 5 | `live` | Incremental sync (verified tables only) |
| ongoing | `reconcile` | Tombstone CRM hard deletes; weekly count audit |

## Commands

```bash
python scripts/crm_mirror_sync.py init-catalog
python scripts/crm_mirror_sync.py backfill --until-done   # recommended: auto-retry until complete
python scripts/crm_mirror_sync.py backfill --table mstoffice
python scripts/crm_mirror_sync.py catchup
python scripts/crm_mirror_sync.py verify
python scripts/crm_mirror_sync.py verify --table trhcalls
python scripts/crm_mirror_sync.py live --daemon
python scripts/crm_mirror_sync.py reconcile
python scripts/crm_mirror_sync.py reconcile --weekly-audit
python scripts/crm_mirror_sync.py status
python scripts/crm_mirror_sync.py dashboard          # web UI at http://127.0.0.1:8765
python scripts/crm_mirror_sync.py retry --table trhcalls
python scripts/crm_mirror_sync.py repair-catalog --fast
```

`repair-catalog --fast` fixes error rows **without CRM calls**: blocks tables with invalid/missing `ncode`, resets pooler prepared-statement failures back to `pending`, and clears stale locks. Use after a crashed backfill before resuming.

### Ensuring every table is filled

| Log message | Meaning | Action |
|-------------|---------|--------|
| `backfill ok on X: N rows` | Table copied; phase → `catching_up` | None |
| `Table phase is catching_up, not pending` | **Already done** (harmless if old log) | None — new code treats this as success |
| `pooler retry on X` | Transient Supavisor glitch | Auto-retried by `--until-done` |
| `backfill blocked on X` | No PK / invalid ncode | Skipped permanently (`blocked`) |
| `backfill failed on X` | Real error (CRM timeout, seal fail, etc.) | Check `last_error` in status; `retry --table X` |

After backfill completes (`pending=0`, `error=0`), **verify** proves each table matches CRM (row count, PK bounds, fingerprints). No table goes `live` without passing all 5 gates.

## Troubleshooting

### `prepared statement "_pg3_0" already exists`

Supavisor transaction pool (port **6543**) is incompatible with psycopg server-side prepared statements. The mirror sets `prepare_threshold=None` on every connection (not `0` — that still prepares after the first repeat).

If errors persist, use a **direct Postgres** URL (SSH tunnel to VPS `:5432`, bypass pooler):

```bash
ssh -N -L 6544:127.0.0.1:5432 root@YOUR_VPS
OLD_CRM_DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:6544/old_crm
```

## Exactness gates (verify)

All must pass before a table becomes `live`:

1. Row count — CRM `COUNT(1)` = mirror `COUNT(*)`
2. PK bounds — `MIN`/`MAX` PK match
3. Timestamp bounds — `MAX(ISNULL(editedon, addedon))` (when columns exist)
4. Row fingerprints — full compare (≤100k rows) or 50 stratified samples
5. Batch audit — sum of completed backfill batch rows = mirror count

Results: `crm_mirror.sync_verifications`.

## Safe fetch rules

- One CRM request at a time; ≥1200 ms gap between requests
- Page size 200, halved on OOM/timeout
- Watermarks advance **only after** batch commit
- Per-table `backfill_started_at` for catch-up (not global)
- Cursor sealing: probe `COUNT WHERE pk > high_water` must be 0 after backfill

## Tombstones

CRM hard deletes are flagged with `_mirror_deleted_at` (row retained). Filter:

```sql
SELECT * FROM crm_raw.trhcalls WHERE _mirror_deleted_at IS NULL;
```

## Runtime

- Run on **local PC or VPS cron** — not Vercel (long-running, millions of CRM requests)
- Full 13–14 GB mirror may take **days**; resume-safe via `sync_state.last_ncode`
- Monitor VPS disk: `df -h` (~20–25 GB with indexes)

## Not used by Vercel app

The dashboard app continues to use `DATABASE_URL` → `postgres` DB and the TS read-model sync worker. `old_crm` is a separate raw archive.
