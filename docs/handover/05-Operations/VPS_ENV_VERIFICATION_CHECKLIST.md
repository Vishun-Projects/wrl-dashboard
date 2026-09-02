# VPS environment verification checklist

> **Status:** Needs sign-off — requires SSH to production host. Values below are **intended** from repo docs; verify on server before marking complete.

**Purpose:** Confirm production VPS configuration before formal handover.  
**Reference:** [`PROD_READ_SOURCE.md`](PROD_READ_SOURCE.md), [`MAIL_SCHEDULE.md`](MAIL_SCHEDULE.md), [`SYNC_ENTRY_POINTS.md`](SYNC_ENTRY_POINTS.md)

---

## Sign-off

| Field | Value |
|-------|-------|
| **Verified by** | _________________________ |
| **Date** | _________________________ |
| **Host / path** | `/opt/fast-close-app` (confirm) |

---

## 1. Postgres read-model flags

SSH to VPS, check `.env` matches intended production (from `PROD_READ_SOURCE.md`):

| Variable | Expected prod | Verified |
|----------|---------------|----------|
| `READ_SUMMARY_FROM` | `postgres` | [ ] |
| `READ_REGISTER_FROM` | `postgres` | [ ] |
| `READ_DISTRIBUTION_FROM` | `postgres` | [ ] |
| `READ_DIMS_FROM` | `postgres` | [ ] |
| `READ_ARCP_FROM` | `postgres` | [ ] |
| `ARCP_USE_LIVE_CRM` | unset or `false` | [ ] |
| `DATABASE_URL` | VPS Postgres | [ ] |

- [ ] Read-model schema applied: `npm run db:apply-read-model:vps`
- [ ] `calls_latest_hot` lag acceptable (~3 min) — check `/admin/sync`

---

## 2. CRM connectivity

- [ ] CRM MS SQL credentials in `.env` (read-only user)
- [ ] Sync worker reaches CRM: `npm run sync-worker:incremental` (or check `sync-worker` systemd logs)
- [ ] No repeated connection errors in sync logs

---

## 3. Mail

- [ ] SMTP / relay per `PROD_READ_SOURCE.md` and `scripts/vps-hosting/`
- [ ] `outboundMailEnabled` + allowed domains tested from Mail & Alerts hub
- [ ] **One** `*/15` crontab line → `mail-scheduler.sh` (not duplicate MIS + subcontractor lines)
- [ ] `mail-scheduler.log` shows recent runs
- [ ] `mis-email-morning-watchdog.sh` cron present (09:50 Mon–Sat)
- [ ] `evening-ops-sequencer.sh` cron present (16:00 daily)

---

## 4. Sync workers (systemd)

| Unit / script | Check |
|---------------|-------|
| `fast-close-sync-worker` (incremental) | [ ] active, logs clean |
| Nightly timer / `sync-worker-nightly.sh` | [ ] runs |
| `/admin/sync` from portal | [ ] healthy status |

---

## 5. Subcontractor stock

- [ ] SAP inbox credentials in config
- [ ] `subcontractor-stock` cron or `mail-scheduler.sh` step runs
- [ ] Manual reconcile test on VPS completed once

---

## 6. Secrets and relay

- [ ] `.env` not in git
- [ ] `CRON_SECRET` matches Vercel if portal relays to VPS
- [ ] Supabase keys on Vercel only (unless VPS needs specific keys)

---

## 7. Backups

- [ ] Postgres backup procedure — **not documented in repo**; ops to define (see [`docs/sync.md`](../../sync.md) rollback note)

---

## Verification commands (examples)

```bash
# On VPS — adjust path
cd /opt/fast-close-app
grep READ_.*_FROM .env
systemctl status fast-close-sync-worker
tail -50 logs/mail-scheduler.log
crontab -l | grep -E 'mail-scheduler|evening-ops|sync'
```

---

## Notes / deviations

<!-- Paste any deviation from PROD_READ_SOURCE.md -->

---

## Approval

| Role | Name | Signature / date |
|------|------|------------------|
| Ops / IT | | |
| Business (optional) | | |
