# Sync entry points

| Job / action | npm script | CLI / entry | VPS script | Cron ID | Owner |
|--------------|------------|-------------|------------|---------|-------|
| Incremental calls sync | `sync-worker:incremental` | `src/lib/read-model/cli.ts incremental` | `sync-worker-daemon.sh` (systemd) | `crm_sync` (pause) | `lib/read-model` |
| Nightly sidecar | `sync-worker:nightly` | `cli.ts nightly` | `sync-worker-nightly.sh` | — | `lib/read-model` |
| Athena sync | `sync-worker:athena-sync` | `cli.ts athena-sync` | nightly timer | — | `modules/athena-reconciliation/server/sync` |
| Athena reconcile | `sync-worker:athena-reconcile` | `cli.ts athena-reconcile` | `midnight-calls-sync.sh` | — | `modules/athena-reconciliation/server/sync` |
| Attendance sync | `sync-worker:attendance-sync` | `attendance/server/sync/run.ts` | nightly timer | — | `modules/attendance/server/sync` |
| User locations | `sync-worker:user-locations-sync` | `attendance/.../user-locations/run.ts` | nightly timer | — | `modules/attendance` |
| Cancelled register | `sync-worker:cancelled-register-sync` | `cancelled-calls/server/sync/run.ts` | nightly timer | — | `modules/cancelled-calls` |
| ARCP incremental | `sync-worker:arcp-incremental` | `cli.ts arcp-incremental` | sync daemon | — | `modules/arcp-claims/server/sync` |
| MIS email digest | `mis-email:digest` | `mis-email/services/cli.ts digest` | `mis-email-digest.sh` / `mail-scheduler.sh` | `mis_email_digest` | `mis-email` |
| Subcontractor stock | `subcontractor-stock:cron` | `subcontractor-stock/services/cli.ts` | `subcontractor-stock-cron.sh` / `mail-scheduler.sh` | `subcontractor_stock` | `subcontractor-stock` |
| Evening ops | `mis-email:evening-ops` | `evening-ops-sequencer.ts` | `evening-ops-sequencer.sh` | `evening_ops_sequencer` | `scripts/vps-hosting` |
| Read-model status API | — | — | — | — | `modules/sync` → `read-model-status` |
| Hot sync (HTTP) | — | — | — | — | `modules/sync` → `calls-hot-sync` |
| VPS cron pause API | — | — | — | — | `modules/sync` → `vps-cron` |

Pause gate: `scripts/vps-hosting/vps-cron-gate.sh` → `src/lib/vps-cron/cli-gate.ts`.

See [`MAIL_SCHEDULE.md`](MAIL_SCHEDULE.md) for mail-specific schedules.
