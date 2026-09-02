> **Status:** Ready (repo-generated). Cron on VPS — verify with `crontab -l` on host.

# Mail schedule (VPS cron)

> Canonical schedule for outbound mail and mail-adjacent jobs.  
> Pause flags: portal **Mail & Alerts → VPS Cron** (`app_org_settings.vps_cron_jobs.paused`).  
> Bash jobs also gate via `scripts/vps-hosting/vps-cron-gate.sh`.

| Job ID | Schedule (IST) | Script | Sends real mail? | Owner module |
|--------|----------------|--------|------------------|--------------|
| `mis_email_digest` | `*/15` Mon–Sat | `mis-email-digest.sh` or `mail-scheduler.sh` | Yes (when in user/routing IST window) | `mis-email` |
| `mis_email_test` | Optional ~14:00 | `mis-email-test-digest.sh` | Yes (test recipients) | `mis-email` |
| `mis_email_watchdog` | 09:50 Mon–Sat | `mis-email-morning-watchdog.sh` | Yes (alert if digest failed) | `mis-email` |
| `subcontractor_stock` | `*/15` daily | `subcontractor-stock-cron.sh` or `mail-scheduler.sh` | Yes (~`send_time_ist`) | `subcontractor-stock` |
| `cancelled_call_digest` | 16:00 via evening-ops | `evening-ops-sequencer.sh` | Yes (probe → ops; prod recipients when not `forceTo`) | `mis-email` + `cancelled-calls` |
| `evening_ops_sequencer` | 16:00 daily | `evening-ops-sequencer.sh` | Yes (status + probes) | `scripts/vps-hosting` |
| `nightly_ytd_calls_export` | 00:00 daily | `nightly-ytd-calls-export.sh` | May (midnight CRM delta) | `mis-email` |
| `midnight_crm_delta_mail` | 05:30 fallback | `midnight-crm-delta-mail-fallback.sh` | Yes | `mis-email` |
| `midnight_crm_delta_watchdog` | 00:30 + 02:00 | `midnight-crm-delta-watchdog.sh` | Yes (alert) | `mis-email` |
| `sync_worker_health` | `*/15` | `sync-worker-health-watchdog.sh` | Yes (alert) | `sync` / lib |

**Not cron — sync worker:** major-repair repeat alerts run inside `fast-close-sync-worker` after incremental sync (`mis-email/server/sync/major-repair-repeat-alert.ts`).

**Unified poller:** `mail-scheduler.sh` runs MIS digest + subcontractor steps in one `*/15` lock. Install: keep one crontab line pointing at `mail-scheduler.sh` instead of separate MIS + subcontractor lines.

**Send transport:** All MIS/cancelled/subcontractor compose paths use `sendDigestPayload()` / `sendHtmlEmail()` in [`send.ts`](../src/modules/mis-email/services/send.ts) (relay on Vercel, direct SMTP on VPS).

See also: [`ARCHITECTURE.md`](ARCHITECTURE.md) §8, [`PROD_READ_SOURCE.md`](PROD_READ_SOURCE.md).
