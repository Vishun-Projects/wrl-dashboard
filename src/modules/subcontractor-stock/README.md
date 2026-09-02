# Subcontractor Stock module

## Why this exists

Daily **SAP subcontractor stock reconciliation**: ingest SAP supplier-group Excel attachments from the VPS mail inbox, match quantities against CRM stock by plant/vendor/material, generate discrepancy workbooks, and email plant recipients. Settings UI is a tab under **Mail & Alerts** (`/admin/mis-email-settings?tab=subcontractor`).

```text
/admin/mis-email-settings?tab=subcontractor  →  SubcontractorStockSettingsPageClient
        ↓
GET/POST/PUT/DELETE /api/admin/subcontractor-stock/settings
        ↓
VPS: sync inbox → reconcile → send (or portal relays to VPS)
        ↓
CRM stock query + SAP parser + reconciliation-engine
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| MIS email digest / routing | `@/modules/mis-email` |
| VPS relay HTTP client | `@/lib/mail/subcontractor-relay-client` |
| Cron registration | `scripts/vps-hosting/` + VPS cron catalog |
| Auth | `page_mis_email_settings` (`mis_email_settings`) |
| SMTP send transport | `@/modules/mis-email/services/send` (`sendHtmlEmail`) |
| Thin stub | `src/app/api/admin/subcontractor-stock/settings/route.ts` |

## Layout

```text
pages/        SubcontractorStockSettingsPageClient
services/
  sap-inbox.ts           IMAP/file inbox sync + dashboard
  sap-parser.ts          Parse SAP supplier-group spreadsheets
  crm-query.ts           Plants, vendors, active materials, stock rows
  reconciliation-engine.ts  SAP vs CRM qty match (normalize vendor/material codes)
  reconcile-runner.ts    Daily run orchestration
  excel-generator.ts     Discrepancy workbook output
  email-sender.ts        Per-recipient HTML + Excel via sendHtmlEmail()
  settings.ts            Skip rules, recipients, config keys, run history
  vps-host.ts            Detect local VPS vs portal relay
  cli.ts                 VPS cron entry (sync → auto-reconcile → send at IST time)
server/routes/  settings.ts (CRUD + manual sync/reconcile/send actions)
```

---

## Core flows

1. Admin opens Mail & Alerts → Subcontractor tab; loads skip rules, recipients, send time, inbox log, recent runs.
2. **Sync inbox** — `action=sync-inbox` on VPS or via relay; upserts SAP mail attachments to Postgres log.
3. **Reconcile** — `action=run-reconciliation` parses today's (or selected) SAP files, queries CRM stock, writes run summary.
4. **Send** — `action=send-emails` attaches Excel per plant recipient; portal manual send requires explicit `recipientIds`.
5. VPS CLI (`services/cli.ts`): poll inbox → auto-reconcile when new files arrive → send at configured IST `send_time`.

---

## Invariants (easy to break)

1. **VPS vs portal** — `isSubcontractorVpsHost()` chooses local execution vs relay; portal cannot run full reconcile/send without relay.
2. **Vendor/material normalization** — `normalizeVendorCode` / `normalizeMaterialCode` must match between SAP parse and CRM keys.
3. **Skip rules** — plant/vendor/material skip list applied before reconcile; bulk create audits as one action.
4. **Same-origin** — POST/PUT/DELETE require `assertSameOriginMutation`.
5. **Audit** — every mutating action logs `subcontractor_stock.*` via `@/lib/security/audit`.

---

## Where to look

| Need | Place |
|------|--------|
| Settings UI | `pages/SubcontractorStockSettingsPageClient.tsx` |
| API | `server/routes/settings.ts` |
| Match math | `services/reconciliation-engine.ts` |
| VPS cron | `services/cli.ts` |
| Inbox sync | `services/sap-inbox.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| SAP file format | `sap-parser.ts`, reconciliation tests |
| CRM stock SQL | `crm-query.ts`, engine expectations |
| Recipient / skip schema | `settings.ts`, API types, UI forms |
| Send schedule | `cli.ts` IST time compare, `send_time_ist` config |
| Portal relay | `@/lib/mail/subcontractor-relay-client`, VPS handler |
