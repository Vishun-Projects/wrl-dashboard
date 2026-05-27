# Sync Worker Specification — Phase 1

Companion to [`read-model-phase1-architecture.md`](./read-model-phase1-architecture.md) and [`read-model-phase1-schema.sql`](./read-model-phase1-schema.sql).

---

## 1. Role

The sync worker is the **only** component allowed to call `postQuery()` / [`src/lib/db-proxy.ts`](../src/lib/db-proxy.ts) for read replication.

It:

1. Fetches changed CRM rows  
2. Joins dimension tables (party, office, user, item, zone, etc.)  
3. Dedups to latest per `vtrnno`  
4. Computes derived fields (status bucket, franchisee, geo, part pending, etc.)  
5. Upserts `calls_latest_hot`  
6. Recomputes affected `call_metrics_daily` grains  
7. Refreshes `dim_*` tables  
8. Writes `raw_ingest_batches` + `sync_run_log` + updates `sync_state`  

---

## 2. Schedule

| Job | Frequency | Cron example |
|-----|-----------|--------------|
| Incremental sync | Every **2–5 minutes** | `*/3 * * * *` |
| Nightly reconcile | Daily **02:00 IST** | `0 2 * * *` |
| Log/batch retention purge | Daily **03:00 IST** | `0 3 * * *` |
| Initial backfill | One-time manual | N/A |

**Hosting:** Railway, Fly.io, Render, or dedicated VM — **not** Vercel serverless (long-running, chunked CRM fetches).

**Environment:**

- `DATABASE_URL` — Postgres read model  
- CRM access via existing `db-proxy` (until direct SQL available)  
- `SYNC_WORKER_ENABLED=true`  
- Single instance only (Phase 1)

---

## 3. Incremental sync algorithm

### 3.1 Acquire lock

```sql
UPDATE sync_state
SET is_running = true
WHERE entity = 'calls_latest_hot' AND is_running = false;
-- If 0 rows updated, exit (another run in progress)
```

Alternatively: `pg_advisory_lock(hashtext('read_model_sync'))`.

### 3.2 Start batch

```text
batch_id = uuid()
INSERT raw_ingest_batches (batch_id, entity, watermark_start, status)
  watermark_start = sync_state.last_editedon - interval '2 minutes'  -- overlap window
```

### 3.3 Fetch from CRM

```sql
-- Pseudocode — executed via postQuery rawSql or table builder
SELECT ...columns...
FROM trhcalls tc
LEFT JOIN mstparty p ON ...
-- (full join set ported from buildCorpusTableName / distribution route)
WHERE ISNULL(tc.editedon, tc.addedon) > @watermark_start
ORDER BY ISNULL(tc.editedon, tc.addedon) ASC
```

Process in CRM fetch chunks (500–1000 rows) if needed.

### 3.4 Transform pipeline (per raw row batch)

1. **Exclude transferred:** `vtransfercallno` empty, `ncancelreason <> 2`  
2. **Dedup in memory** by `vtrnno` — keep latest `editedon`, then `ncode`  
3. **Apply hot inclusion rule** — drop rows outside 90d + open-old exception  
4. **Resolve branch/franchisee** — port `enrichTrhcallBranchFranchisee` / `resolveBranchFranchisee`  
5. **Compute `status_bucket`** — port `classifyRegisterRowStatus`  
6. **Compute `is_part_pending`** — port `isPartPending` from `report-summary-derive.ts`  
7. **Normalize geo** — city/state uppercase trim  
8. **Map to typed Postgres row**

### 3.5 Upsert hot rows

```sql
INSERT INTO calls_latest_hot (...)
VALUES (...)
ON CONFLICT (vtrnno) DO UPDATE SET
  ... all columns ...,
  synced_at = now();
```

### 3.6 Recompute daily facts

For each distinct `(fact_date, office_id, call_type, account, region)` touched by upserted rows:

- Re-aggregate counts from CRM source for that day+dimensions **or** incrementally adjust from row status (nightly reconcile validates)

Upsert:

```sql
INSERT INTO call_metrics_daily (...)
ON CONFLICT (fact_date, office_id, call_type, account, region) DO UPDATE SET
  total = EXCLUDED.total,
  ...
  synced_at = now();
```

**Phase 1 fact scope:** only rows where `fact_date >= date_trunc('year', current_date)`.

### 3.7 Commit watermark

Only after successful transaction:

```sql
UPDATE sync_state SET
  last_editedon = @max_editedon_seen,
  last_addedon = @max_addedon_seen,
  last_run_at = now(),
  is_running = false,
  rows_upserted_last = @count,
  status = 'ok'
WHERE entity = 'calls_latest_hot';

UPDATE raw_ingest_batches SET
  status = 'completed',
  watermark_end = @max_editedon_seen,
  row_count = @count,
  checksum = @optional_hash
WHERE batch_id = @batch_id;
```

### 3.8 Release lock

Set `is_running = false` on success or failure.

---

## 4. Nightly reconcile

1. **Hot window refresh** — re-fetch all TRNs in 90d window + open-old query from CRM; upsert + delete orphans in Postgres not in CRM result set  
2. **Prune hot table:**

```sql
DELETE FROM calls_latest_hot h
WHERE NOT (
  h.logged_at >= now() - interval '90 days'
  OR (
    h.status_bucket IN ('open_unallocated', 'assigned', 'tech_solved')
    AND h.logged_at < now() - interval '90 days'
  )
);
```

3. **Rebuild current-year facts** — truncate `call_metrics_daily` where `fact_date >= year_start`, recompute from CRM YTD (or from hot + CRM backfill for dates outside hot window within current year)  
4. **Refresh dims** — full replace `dim_offices`, `dim_engineers`, `dim_call_types`  
5. Log run in `sync_run_log` with `rows_deleted` count  

---

## 5. Initial backfill

Order:

1. Apply schema DDL  
2. Refresh `dim_*` from CRM  
3. Backfill `calls_latest_hot`:
   - Chunk by calendar week for last 90 days (~138k raw rows)  
   - Separate batch for open-old exception query (~1,801 TRNs)  
4. Backfill `call_metrics_daily` for `fact_date >= Jan 1 current year`  
5. Set watermarks to `max(editedon)` seen  
6. Mark `sync_state.status = 'ok'`  

**Duration estimate:** hours through HTML proxy — run as background job with progress in `sync_run_log`.

---

## 6. Source-of-truth conflict policy

| Scenario | Action |
|----------|--------|
| CRM row updated | Upsert overwrites hot row; recompute facts for affected dates |
| Call closed + aged out of 90d | Hard delete on nightly prune |
| Open call no longer open | Hard delete on nightly if outside 90d |
| TRN vanishes from CRM (rare) | After 2 nightly reconcile misses: hard delete + log in `raw_ingest_batches` |
| Duplicate batch replay | Safe — upserts idempotent |
| Metrics drift | Nightly full YTD fact rebuild |

**Phase 1:** hard delete only (no tombstone column).

---

## 7. Failure tolerance

| Concern | Rule |
|---------|------|
| Single worker | One instance; advisory lock or `is_running` |
| CRM retry | 3 attempts, exponential backoff (3s, 10s, 30s); log each in `sync_run_log` |
| Partial batch | Mark `raw_ingest_batches.status = 'partial'`; **do not** advance watermark |
| Watermark overlap | Re-fetch from `last_editedon - 2 minutes` to catch edge edits |
| Parallel workers | **Forbidden** Phase 1 |
| Transaction scope | One batch commit per incremental run; rollback on failure |

On failure:

```sql
UPDATE raw_ingest_batches SET status = 'failed' WHERE batch_id = @batch_id;
INSERT sync_run_log (..., status = 'failed', error_message = ...);
UPDATE sync_state SET is_running = false, status = 'error';
```

---

## 8. Rebuild procedures

### 8.1 Rebuild `calls_latest_hot`

```text
1. TRUNCATE calls_latest_hot;
2. Reset sync_state.last_editedon to epoch;
3. Run initial backfill (90d + open-old);
4. Verify row count ~139,509.
```

### 8.2 Rebuild `call_metrics_daily` (current year)

```text
1. DELETE FROM call_metrics_daily WHERE fact_date >= Jan 1 current year;
2. Re-aggregate from CRM for YTD (deduped latest per vtrnno);
3. Verify branch totals against CRM spot-check query.
```

### 8.3 Rebuild dimensions

```text
TRUNCATE dim_offices, dim_engineers, dim_call_types;
Full fetch from mstoffice, mstusers, mstfixedselection (ncalltype).
```

### 8.4 Full system rebuild

```text
Run 8.3 → 8.1 → 8.2 in order.
Reset all sync_state watermarks.
```

---

## 9. Retention jobs

| Table | Retention | Action |
|-------|-----------|--------|
| `sync_run_log` | 30 days | `DELETE WHERE started_at < now() - interval '30 days'` |
| `raw_ingest_batches` | 90 days | `DELETE WHERE created_at < now() - interval '90 days'` |
| `call_metrics_daily` | Current year Phase 1 | Delete prior-year rows on Jan 1 or expand in Phase 2 |

---

## 10. Observability

Log every run:

- `entity`, `batch_id`, `duration_ms`, `rows_upserted`, `rows_deleted`, `status`  
- CRM fetch chunk failures with query snippet  
- Watermark before/after  

Alert thresholds (manual Phase 1):

- Sync lag > 15 minutes  
- 3 consecutive failed runs  
- Hot row count drops > 10% day-over-day  

---

## 11. Code layout (implementation phase — not built yet)

Suggested module structure:

```text
scripts/sync-worker/
  index.ts              -- scheduler entry
  lock.ts               -- advisory lock
  crm-fetch.ts          -- postQuery wrappers
  transform/
    dedup.ts
    hot-inclusion.ts
    status-bucket.ts
    franchisee.ts
    metrics.ts
  upsert/
    hot.ts
    facts.ts
    dims.ts
  reconcile/nightly.ts
  backfill/initial.ts
  log/batches.ts
```

Reuse existing logic from:

- `src/lib/trhcalls-query.ts`  
- `src/lib/report-summary-derive.ts`  
- `src/lib/report-geo.ts`  

---

## 12. `raw_ingest_batches` usage

Every incremental and nightly run **must** insert a batch row at start and update at end.

Optional `checksum`: SHA-256 of sorted `vtrnno` list upserted in batch — enables spot reconciliation against CRM count queries.

Never store full CRM payloads in this table.
