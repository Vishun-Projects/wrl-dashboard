# WRL Portal — Architecture Documentation

> **Product:** WRL Portal (WRL Dashboard)  
> **Stack:** Next.js · Supabase (auth/profiles) · Postgres read-model (VPS) · CRM (trhcalls)  
> **Repo:** `fast-close-app`

---

## 0. Start Here

### Run locally

```bash
npm install
npm run dev          # Next.js on localhost:3000
# Optional — point READ_SUMMARY_FROM=postgres in .env.local to query the VPS Postgres instead of CRM
```

For VPS workers (sync + email) see `scripts/vps-hosting/README.md`.

### Reading order for a new developer

| Step | Read | Why |
|---|---|---|
| 1 | **§1 Module Map** | Understand which modules exist and how they connect |
| 2 | **§6 Deployment / Infrastructure** | Know where each piece actually runs |
| 3 | **§7 ETL Data Flow** | Understand CRM → hot table → portal → output |
| 4 | **§8 Background Jobs** | Know what runs on the VPS and when |
| 5 | **§2.1–2.2 Auth + MIS Load** | Two most common user flows |
| 6 | **§2.8–2.12** (cancelled, Athena, digests, subcontractor, attendance) | Newer report + ops flows |
| 7 | **§10 RBAC Flow** | Before touching permissions or API routes |
| 8 | **§11 Failure Paths** | Before touching production |

**Diagram assets:** `docs/diagrams/` — 20 Mermaid sources (`.mmd`) + PNG renders. Regenerate with `node scripts/ops/export-mermaid-diagrams.mjs` after editing diagrams in this file.

---

## 0.1 Known Limitations & Design Decisions

> These are deliberate simplifications or known gaps — not bugs to fix immediately.

| Area | Decision / Limitation | Ceiling / Upgrade path |
|---|---|---|
| **RLS** | Supabase Row-Level Security is not used; access is enforced in application code via RBAC catalog + office-scope filter on every query | Enable RLS policies when multi-tenant isolation becomes a hard requirement |
| **Read-model staleness** | `calls_latest_hot` can lag CRM by up to ~3 min (sync cycle); call detail drawer always hits CRM live | Acceptable for reporting; not suitable for real-time ops |
| **No `.test.tsx` coverage** | UI components have near-zero browser test coverage; server logic has targeted unit tests only (`mail-basis`, `major-repair-alert`) | Add Playwright or Vitest browser tests when UI stabilises |
| **Pagination inconsistency** | Some API routes return all rows (register export), others paginate. No unified cursor scheme | Standardise to cursor-based pagination if row counts grow past ~50k |
| **One-PR-per-slice** | Module boundary discipline is aspirational; some shared logic still lives in root `src/lib` rather than being owned by one module | Enforce via lint rule (`no-cross-module-import`) when team grows |
| **Email transport** | All outbound mail (MIS digest, cancelled digest, major-repair, subcontractor) uses `sendDigestPayload()` / `sendHtmlEmail()` in `mis-email/services/send.ts` — relay on Vercel, direct SMTP on VPS | |
| **Email retry** | Failed digest sends are logged but not retried automatically; next cron poll (15 min) is the retry | Add a send-retry queue if delivery SLA tightens |
| **CRM is MS SQL / read-only** | All CRM writes go through the CRM application, not the portal; portal is strictly a reporting read layer | |
| **VPS Postgres is not HA** | Single-node Postgres on Hostinger VPS; no replica or auto-failover | Migrate to managed Postgres (Supabase, RDS) if uptime SLA requires 99.9%+ |

> **Rule:** Update this document only when the codebase changes (schema migration, new module, new cron job, RBAC change). Do not update speculatively.

---

## 1. System Workflow — Module Map

```mermaid
flowchart TD
    subgraph Browser["Browser (Next.js SSR + Client)"]
        LOGIN["login / forgot-password"]
        REPORT["/report — MIS Reports"]
        ARCP["/report/arcp-claims"]
        DIST["/report/distribution"]
        SERIAL["/report/serial-audit"]
        LOCAUD["/report/location-audit"]
        WARR["/report/warranty-master"]
        CANCEL["/report/cancelled-calls"]
        ATHENA["/report/athena-reconciliation"]
        ADMIN["/admin — Users / Roles / Sync / VPS Cron"]
        ATTEND["/admin/attendance"]
        PROFILE["/profile — Prefs + MIS email"]
        PERF["/admin/performance-insights"]
        MAILSET["/admin/mis-email-settings"]
    end

    subgraph AUTH["auth module"]
        SIGNIN["sign-in"]
        SIGNOUT["sign-out"]
        ME["GET /me"]
        FORGOT["forgot-password"]
        RESET["complete-reset"]
    end

    subgraph MIS["mis module"]
        SUMMARY["Summary Dashboard"]
        REGISTER["Call Register"]
        BDMIS["BD-MIS (Cadbury/Coke merge)"]
        CLIMPORT["Client Import (upload → normalize → batch)"]
    end

    subgraph CALLS["calls module"]
        CALLBYID["call-by-id (CRM full graph)"]
        COMMENTS["comments (Postgres)"]
        FLAGS["flags (portal triage)"]
        OFFICES["offices dimension"]
    end

    subgraph MISMAIL["mis-email module"]
        RUNDIGEST["run-digest (cron + CLI)"]
        COMPOSEDIGEST["compose-digest"]
        MAILBASIS["mail-basis (Cadbury-safe counts)"]
        PREFS["preferences / scheduling"]
        ROUTING["routing-rules (slot dedupe)"]
        SEND["send.ts\nsendDigestPayload · sendHtmlEmail"]
        MAJREP["major-repair-repeat-alert (sync worker)"]
        CANCELDIG["cancelled-call-digest (evening-ops)"]
    end

    subgraph ARCP_MOD["arcp-claims module"]
        ARCPPAGE["ArcpClaimsPageClient"]
        HYBRID["hybrid-load (Postgres ↔ CRM)"]
        ARCPSYNC["sync worker (hot backfill)"]
    end

    subgraph SYNC_MOD["sync module"]
        RMSTATUS["read-model-status API"]
        VPSCRON["vps-cron pause/resume API"]
    end

    subgraph CANCEL_MOD["cancelled-calls module"]
        CANCELREG["Cancelled register (Postgres)"]
        CANCELEX["CSV + digest Excel export"]
    end

    subgraph ATHENA_MOD["athena-reconciliation module"]
        ATHENAPAGE["AthenaReconciliationPageClient"]
        ATHENASYNC["sync + reconcile (read-model)"]
    end

    subgraph ATTEND_MOD["attendance module"]
        ACTIVITY["Service call activity report"]
    end

    subgraph SUBCON_MOD["subcontractor-stock module"]
        SUBCONUI["Mail & Alerts → Subcontractor tab"]
        SUBCONRUN["SAP inbox → reconcile → email (VPS)"]
    end

    subgraph INFRA["Infrastructure / Shared Lib"]
        SUPABASE["Supabase (auth + app_users)"]
        POSTGRES["Postgres VPS (read-model hot tables)"]
        CRM["CRM (trhcalls — source of truth)"]
        SMTP["SMTP / VPS Postfix relay"]
        READMODEL["@/lib/read-model (incremental/nightly sync CLI)"]
        VPSCRONLIB["@/lib/vps-cron (pause catalog)"]
        AUDIT["@/lib/security/audit (logAction)"]
    end

    LOGIN --> AUTH
    REPORT --> MIS
    REPORT --> CALLS
    ARCP --> ARCP_MOD
    DIST --> MIS
    SERIAL --> MIS
    LOCAUD --> MIS
    WARR --> MIS
    CANCEL --> CANCEL_MOD
    ATHENA --> ATHENA_MOD
    ADMIN --> SYNC_MOD
    ATTEND --> ATTEND_MOD
    PROFILE --> MISMAIL
    MAILSET --> MISMAIL
    MAILSET --> SUBCON_MOD

    MIS --> POSTGRES
    MIS --> CRM
    CALLS --> CRM
    CALLS --> POSTGRES

    MISMAIL --> MAILBASIS
    MAILBASIS --> POSTGRES
    MAILBASIS --> MIS
    RUNDIGEST --> COMPOSEDIGEST --> MAILBASIS
    RUNDIGEST --> SEND
    MAJREP --> SEND
    SEND --> SMTP
    RUNDIGEST --> AUDIT
    RUNDIGEST --> ROUTING
    CANCELDIG --> CANCEL_MOD
    CANCELDIG --> SEND

    ARCP_MOD --> POSTGRES
    ARCP_MOD --> CRM

    AUTH --> SUPABASE
    AUTH --> AUDIT

    SYNC_MOD --> VPSCRONLIB
    SYNC_MOD --> POSTGRES

    CANCEL_MOD --> POSTGRES
    ATHENA_MOD --> POSTGRES
    ATHENA_MOD --> CRM
    ATTEND_MOD --> CRM
    SUBCON_MOD --> POSTGRES
    SUBCON_MOD --> CRM
    SUBCON_MOD --> SEND

    READMODEL --> POSTGRES
    READMODEL --> CRM
```

---

## 2. Sequence Diagrams

### 2.1 — User Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant AuthMod as auth module
    participant Supabase
    participant AuditLog as security audit

    User->>Browser: Enter email + password → Submit
    Browser->>NextJS: POST /api/auth/sign-in
    NextJS->>AuthMod: sign-in handler
    AuthMod->>Supabase: GoTrue signInWithPassword()
    Supabase-->>AuthMod: JWT + session
    AuthMod->>AuditLog: logAction(session.start)
    AuthMod->>NextJS: set session cookies (soft-timeout)
    NextJS-->>Browser: 200 OK + cookies
    Browser->>NextJS: GET /api/auth/me (poll)
    NextJS->>AuthMod: me handler
    AuthMod->>Supabase: verify JWT / resolve profile
    AuthMod-->>Browser: profile + permissions + sessionExpiresAt
    Browser->>Browser: Route to first allowed report page

    Note over Browser,Supabase: On sign-out
    User->>Browser: Click Sign Out
    Browser->>NextJS: POST /api/auth/sign-out
    NextJS->>AuthMod: clear cookies BEFORE GoTrue signOut
    AuthMod->>Supabase: GoTrue signOut
    AuthMod->>AuditLog: logAction(session.end)
    NextJS-->>Browser: 200 + clear cookies, redirect /login
```

---

### 2.2 — MIS Report Page Load

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant MISMod as mis module
    participant Postgres as Postgres VPS
    participant CRM

    User->>Browser: Open /report
    Browser->>NextJS: GET /api/auth/me
    NextJS-->>Browser: profile + RBAC permissions
    Browser->>Browser: ReportFiltersProvider init (role-baseline filters)

    Browser->>NextJS: GET /api/report/summary (dates, officeIds, callType)
    NextJS->>MISMod: summary handler
    MISMod->>Postgres: querySummaryDashboard()
    Postgres-->>MISMod: branchSummary + accountSummary rows
    MISMod-->>Browser: SummaryDashboard JSON

    User->>Browser: Switch to Call Register tab
    Browser->>NextJS: GET /api/report/register (filters + page)
    NextJS->>MISMod: register handler
    MISMod->>Postgres: queryDigestRegisterExport()
    Postgres-->>MISMod: register rows
    MISMod-->>Browser: rows + totals

    User->>Browser: Click TRN row
    Browser->>NextJS: GET /api/calls/:id
    NextJS->>CRM: postQuery trhcalls (parent + history + visits + faults + parts)
    CRM-->>NextJS: full call graph
    NextJS->>Postgres: load call_comments + call_flags for TRN
    Postgres-->>NextJS: portal annotations
    NextJS-->>Browser: CallDetail payload
    Browser->>Browser: Open CallDetailDialog drawer
```

---

### 2.3 — MIS Email Digest (Cron / Automated)

```mermaid
sequenceDiagram
    autonumber
    participant VPS as VPS Cron\nmail-scheduler.sh (*/15 IST)
    participant RunDigest as run-digest.ts
    participant VpsCronLib as vps-cron settings
    participant Recipients as recipients.ts
    participant RoutingRules as routing-rules.ts
    participant Prefs as preferences.ts
    participant Compose as compose-digest.ts
    participant MailBasis as mail-basis.ts
    participant FetchData as fetch-digest-data.ts
    participant FetchTrace as fetch-digest-trace.ts
    participant Postgres as Postgres VPS
    participant CRM
    participant Attachments as build-attachments.ts
    participant Send as send.ts
    participant SMTP as SMTP / VPS relay
    participant AuditLog as security audit

    VPS->>RunDigest: runMisEmailDigest()
    RunDigest->>VpsCronLib: isVpsCronPaused('mis_email_digest')?
    VpsCronLib-->>RunDigest: false (proceed)

    RunDigest->>Recipients: loadDigestRecipients()
    Recipients->>Postgres: query app_users (mis_email_enabled=true)
    Postgres-->>Recipients: recipient list

    RunDigest->>RoutingRules: listMisEmailRoutingRules()
    Postgres-->>RoutingRules: routing rule rows

    loop For each personal recipient
        RunDigest->>Prefs: shouldSendMisEmailNow(prefs, windowMinutes=15)
        Prefs-->>RunDigest: true/false (IST half-open window)
        alt In send window
            RunDigest->>Compose: buildMisEmailPayload(recipient)
            Compose->>FetchData: fetchDigestSummaryDataCached(scope, dateRange)
            FetchData->>Postgres: querySummaryDashboard()
            Postgres-->>FetchData: branchSummary + accountSummary
            Compose->>FetchData: fetchDigestClientAccountSummaryCached()
            FetchData->>Postgres: queryClientAccountSummary()
            Compose->>FetchTrace: buildDigestTraceableExportPayload()
            FetchTrace->>Postgres: queryBdMisCrmCallTraceRows()
            FetchTrace->>Postgres: queryClientCallTraceRowsFiltered()
            FetchTrace->>Postgres: enrichRegisterRowsRepairDone()
            FetchTrace-->>Compose: traceRows + regionalRows
            Compose->>MailBasis: buildMisEmailRegionalAndBranchRowsFromTrace()
            MailBasis-->>Compose: regional + branch performance rows
            Compose->>Attachments: buildDigestAttachments()
            Attachments-->>Compose: Excel buffers (Summary + Register + Traceable)
            Compose-->>RunDigest: preview + emailAttachments + bodyHtml
            RunDigest->>Send: sendDigestEmail() → sendDigestPayload()
            Send->>SMTP: VPS relay (portal) or direct SMTP (VPS)
            SMTP-->>Send: messageId
            RunDigest->>AuditLog: logAction(notification.mis_email.digest.sent)
        else Outside window
            RunDigest->>RunDigest: push to skipped[]
        end
    end

    loop For each routing rule
        RunDigest->>RoutingRules: shouldTriggerRoutingRuleNow(rule)
        RoutingRules-->>RunDigest: true/false
        RunDigest->>RoutingRules: hasSuccessfulRoutingSendInSlot(ruleId, since)
        Postgres-->>RoutingRules: already sent?
        alt Rule due + not already sent
            RunDigest->>Compose: buildMisEmailPayload(composer)
            Note right of Compose: Same data pipeline as personal digest
            Compose-->>RunDigest: emailAttachments + bodyHtml
            RunDigest->>Send: sendDigestEmail() → sendDigestPayload()
            Send->>SMTP: VPS relay or direct SMTP
            RunDigest->>RoutingRules: logMisEmailRoutingSendAttempt(sent)
            RunDigest->>AuditLog: logAction(digest.sent, ruleId)
        end
    end

    RunDigest-->>VPS: sent[] + skipped[] + failed[] + durationMs
```

---

### 2.4 — Manual MIS Email Compose & Send (Profile Page)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant RouteHandler as mis-email routes
    participant Compose as compose-digest.ts
    participant Postgres
    participant Send as send.ts
    participant SMTP

    User->>Browser: Open Profile → MIS Email tab
    Browser->>NextJS: GET /api/mis-email/profile-prefs
    NextJS->>Postgres: load mis_email_preferences from app_users
    Postgres-->>Browser: saved preferences

    User->>Browser: Adjust settings → Preview
    Browser->>NextJS: POST /api/mis-email/profile-preview
    NextJS->>RouteHandler: profile-preview handler
    RouteHandler->>Compose: previewMisEmailCompose(recipient, forPreview=true)
    Compose->>Postgres: fetchDigestSummaryDataCached()
    Compose->>Postgres: fetchDigestClientAccountSummaryCached()
    Note right of Compose: Skips Excel build — preview only
    Compose-->>Browser: subject + html + attachmentFilenames + scopeLabel

    User->>Browser: Click Send
    Browser->>NextJS: POST /api/mis-email/profile-send
    NextJS->>RouteHandler: profile-send handler
    RouteHandler->>Compose: sendMisEmailComposeBatch(recipient, opts)
    Compose->>Postgres: Full pipeline (summary + trace + register)
    Compose->>Compose: buildDigestAttachments() → Excel buffers
    Compose->>Send: sendDigestPayload(to, subject, html, attachments)
    Send->>SMTP: relay or direct SMTP
    SMTP-->>Send: messageId
    Send-->>Browser: sentTo + attachments[] + messageId
```

---

### 2.5 — Major Repair Repeat Alert

```mermaid
sequenceDiagram
    autonumber
    participant SyncWorker as Sync Worker (CLI / nightly)
    participant AlertWorker as major-repair-repeat-alert.ts
    participant Recipients as branch-recipient-store\n(major-repair)
    participant Postgres
    participant Send as send.ts
    participant SMTP

    SyncWorker->>AlertWorker: detectAndSendMajorRepeatAlerts()
    AlertWorker->>Postgres: query repeat major-repair TRNs (calls_latest_hot)
    Postgres-->>AlertWorker: repeat case rows
    loop For each repeat case
        AlertWorker->>Recipients: resolveAlertRecipients(branchId)
        Recipients->>Postgres: query major_repair_recipients (enabled + branch)
        Postgres-->>Recipients: branch rows (To) + HQ rows (Cc)
        Note right of Recipients: Branch To wins — HQ demotes to Cc
        Recipients-->>AlertWorker: to[] + cc[]
        AlertWorker->>Send: sendHtmlEmail(to, cc, alertHtml)
        Send->>SMTP: sendDigestPayload → relay or SMTP
        SMTP-->>AlertWorker: messageId
        AlertWorker->>Postgres: log alert send
    end
```

---

### 2.6 — CRM → Postgres Read-Model Sync Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Cron as VPS Cron (CLI)
    participant CLI as lib/read-model/cli.ts
    participant VpsCronLib as lib/vps-cron
    participant Lock as lock.ts
    participant Incremental as incremental.ts
    participant CrmFetch as crm-fetch.ts
    participant Transform as transform.ts
    participant Upsert as upsert-hot.ts
    participant Postgres as Postgres VPS
    participant CRM as CRM (trhcalls)

    Cron->>CLI: tsx lib/read-model/cli.ts incremental
    CLI->>VpsCronLib: isVpsCronPaused('crm_sync')?
    VpsCronLib-->>CLI: false
    CLI->>Lock: acquireSyncLock()
    Lock->>Postgres: advisory lock on sync_lock
    Postgres-->>Lock: acquired

    CLI->>Incremental: runIncrementalSync()
    Incremental->>Postgres: get last editedon watermark
    Postgres-->>Incremental: watermark timestamp

    Incremental->>CrmFetch: fetchCrmCallsDelta(since=watermark)
    CrmFetch->>CRM: postQuery trhcalls WHERE editedon > watermark
    CRM-->>CrmFetch: changed rows (batch)

    loop For each batch
        CrmFetch->>Transform: transformCrmRows(rawRows)
        Transform-->>Upsert: transformed hot rows
        Upsert->>Postgres: upsert calls_latest_hot (ON CONFLICT UPDATE)
        Postgres-->>Upsert: upserted count
    end

    Incremental->>Postgres: update editedon watermark + sync_meta
    Lock->>Postgres: release advisory lock
    CLI-->>Cron: upserted + duration + errors
```

---

### 2.7 — ARCP Claims Load (Hybrid Postgres ↔ CRM)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant ArcpMod as arcp-claims module
    participant HybridLoad as hybrid-load.ts
    participant Postgres
    participant CRM

    User->>Browser: Open /report/arcp-claims → set date basis
    Browser->>NextJS: POST /api/report/arcp-claims/load-start
    NextJS->>ArcpMod: route-auth (page_arcp_claims + office scope)
    ArcpMod->>HybridLoad: startOrResumeLoadJob(filters)
    HybridLoad->>Postgres: check arcp_lines_hot coverage for date range
    alt Postgres has full coverage
        Postgres-->>HybridLoad: hot rows sufficient
        HybridLoad-->>Browser: jobId + source=postgres
    else Gap — fall back to CRM
        HybridLoad->>CRM: postQuery arcp lines (weekly chunks)
        CRM-->>HybridLoad: raw ARCP lines
        HybridLoad->>Postgres: upsert arcp_lines_hot + mark coverage
        HybridLoad-->>Browser: jobId + source=crm
    end

    loop Poll until complete
        Browser->>NextJS: GET /api/report/arcp-claims/load-status?jobId=...
        NextJS->>Postgres: check job progress rows
        Postgres-->>Browser: progress% + chunksDone + total
    end

    Browser->>NextJS: GET /api/report/arcp-claims/aggregates
    NextJS->>Postgres: queryArcpAggregates(filters + officeScope)
    Postgres-->>Browser: aggregated claims data

    User->>Browser: Export detail CSV
    Browser->>NextJS: GET /api/report/arcp-claims/detail-export
    NextJS->>Postgres: stream arcp_lines_hot rows
    Postgres-->>Browser: CSV stream
```

---

### 2.8 — Cancelled Calls Report

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant CancelMod as cancelled-calls module
    participant Postgres as Postgres VPS

    User->>Browser: Open /report/cancelled-calls
    Browser->>NextJS: GET /api/auth/me
    NextJS-->>Browser: profile + RBAC (page_cancelled_calls or Athena alias)

    Browser->>NextJS: GET /api/report/cancelled-calls?mode=options
    NextJS->>CancelMod: fetchCancelledCallsFilterOptions()
    CancelMod->>Postgres: distinct branches / franchisees / call types
    Postgres-->>Browser: filter options

    Browser->>NextJS: GET ?mode=summary + date/filters
    NextJS->>CancelMod: fetchCancelledCallsSummary()
    CancelMod->>Postgres: aggregate calls_cancelled (office scope)
    Postgres-->>Browser: KPI summary

    Browser->>NextJS: GET ?mode=rows&page=1
    NextJS->>CancelMod: fetchCancelledCallsRows()
    CancelMod->>Postgres: paginated register rows
    Postgres-->>Browser: rows + total

    User->>Browser: Export CSV
    Browser->>NextJS: GET ?format=csv
    NextJS->>CancelMod: buildCancelledCallsCsvStream()
    CancelMod->>Postgres: full filtered set
    Postgres-->>Browser: CSV download
```

---

### 2.9 — Athena Failed-Calls Reconciliation

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Browser
    participant NextJS as Next.js API
    participant AthenaMod as athena-reconciliation module
    participant ReadModel as lib/read-model/athena-reconciliation
    participant Postgres as Postgres VPS
    participant CRM

    User->>Browser: Open /report/athena-reconciliation
    Browser->>NextJS: GET ?mode=summary
    NextJS->>AthenaMod: fetchAthenaReconciliationSummary()
    AthenaMod->>Postgres: KPIs from athena_failed_calls_normalized
    Postgres-->>Browser: status breakdown + counts

    Browser->>NextJS: GET ?mode=rows
    NextJS->>AthenaMod: fetchAthenaFailedCallsRows()
    AthenaMod->>Postgres: paginated failed-call rows
    Postgres-->>Browser: table rows

    User->>Browser: View payload / matches
    Browser->>NextJS: GET ?mode=detail&id=…
    NextJS->>AthenaMod: fetchAthenaFailedCallDetail()
    Postgres-->>Browser: raw payload + match detail

    User->>Browser: Trigger sync (admin action)
    Browser->>NextJS: POST { action: sync }
    NextJS->>ReadModel: runAthenaFailedCallsSync()
    ReadModel->>CRM: fetch new Athena failures
    ReadModel->>Postgres: upsert raw + normalized rows
    Postgres-->>Browser: sync stats

    User->>Browser: Reconcile against register
    Browser->>NextJS: POST { action: reconcile }
    NextJS->>ReadModel: executeAthenaReconciliation()
    ReadModel->>Postgres: match vs calls_latest_hot → update status
    Postgres-->>Browser: reconcile stats
```

---

### 2.10 — Cancelled Call Digest (Evening Ops)

```mermaid
sequenceDiagram
    autonumber
    participant Cron as VPS Cron 16:00 IST\nevening-ops-sequencer.sh
    participant EveningOps as evening-ops-sequencer.ts
    participant CancelDigest as cancelled-call-digest.ts
    participant CancelMod as cancelled-calls module
    participant Postgres as Postgres VPS
    participant Send as send.ts
    participant SMTP as SMTP / VPS relay

    Cron->>EveningOps: run evening ops probe
    EveningOps->>EveningOps: isVpsCronPaused per step (TS)
    EveningOps->>EveningOps: MIS compose probe (optional)
    EveningOps->>CancelDigest: runCancelledCallDigest({ force, forceTo })
    CancelDigest->>CancelMod: fetchCancelledCallsForDigestDay(yesterday IST)
    CancelMod->>Postgres: calls_cancelled by branch
    Postgres-->>CancelDigest: rows grouped by branch
    CancelDigest->>CancelMod: buildCancelledCallsWorkbook(byBranch)
    loop For each branch recipient
        CancelDigest->>Postgres: wasCancelledDigestAlreadySent?
        alt Not yet sent today
            CancelDigest->>Send: sendDigestPayload(Excel attach)
            Send->>SMTP: relay or direct SMTP
            CancelDigest->>Postgres: recordCancelledDigestSent()
        end
    end
    CancelDigest-->>EveningOps: sent[] + skipped[] + failed[]
```

---

### 2.11 — Subcontractor Stock (SAP vs CRM)

```mermaid
sequenceDiagram
    autonumber
    participant Cron as VPS mail-scheduler.sh\nstep 2 (*/15 IST)
    participant CLI as subcontractor-stock/cli.ts
    participant Inbox as sap-inbox.ts
    participant Reconcile as reconcile-runner.ts
    participant Engine as reconciliation-engine.ts
    participant CRM as CRM (old_crm stock)
    participant Postgres as Postgres VPS
    participant EmailSender as email-sender.ts
    participant Send as send.ts
    participant SMTP as SMTP / VPS relay

    Cron->>CLI: sync-inbox → cron loop
    CLI->>Inbox: syncSapMailInbox()
    Inbox->>Postgres: upsert subcontractor_sap_mail_log

    CLI->>Reconcile: runTodayReconciliation() when new SAP files
    Reconcile->>Inbox: load today's SAP spreadsheets
    Reconcile->>Engine: reconcileSapVsCrm(rows)
    Engine->>CRM: fetchCrmStock by plant/vendor/material
    CRM-->>Engine: CRM quantities
    Engine-->>Reconcile: discrepancies + matches
    Reconcile->>Postgres: insert subcontractor_stock_runs

    CLI->>EmailSender: triggerSubcontractorEmails() at send_time_ist
    loop For each enabled recipient (plant)
        EmailSender->>Postgres: load run + filter by plant
        EmailSender->>EmailSender: excel-generator workbook + HTML body
        EmailSender->>Send: sendHtmlEmail(attachment)
        Send->>SMTP: sendDigestPayload → relay or SMTP
    end

    Note over Cron,SMTP: Portal manual actions relay to VPS via mail-relay-server.ts
```

---

### 2.12 — Service Call Activity (Admin)

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant Browser
    participant NextJS as Next.js API
    participant AttendMod as attendance module
    participant SQL as sql/attendance/activity-report
    participant Postgres as Postgres VPS

    Admin->>Browser: Open /admin/attendance
    Browser->>NextJS: GET /api/auth/me
    NextJS-->>Browser: manage_users required

    Browser->>NextJS: GET /api/admin/attendance?meta=offices
    NextJS->>AttendMod: queryAttendanceOfficeOptions()
    AttendMod->>SQL: office list for date window
    SQL->>Postgres: crm_attendance_details
    Postgres-->>Browser: offices + org settings

    Browser->>NextJS: GET /api/admin/attendance (paginated)
    NextJS->>AttendMod: queryActivityReport()
    AttendMod->>SQL: filtered activity rows
    SQL->>Postgres: crm_attendance_details JOIN filters
    Postgres-->>Browser: rows + total

    Admin->>Browser: Export CSV
    Browser->>NextJS: GET ?export=csv
    NextJS->>AttendMod: queryActivityReportExport()
    AttendMod->>SQL: capped export + buildActivityReportCsv()
    Postgres-->>Browser: CSV download
```

---

## 3. Data Layer Reference

| Table / Source | Owner | Purpose |
|---|---|---|
| `calls_latest_hot` | `@/lib/read-model` | CRM call mirror, incremental sync |
| `calls_cancelled` | `@/lib/read-model/cancelled-call-register` | Cancelled call register (Postgres) |
| `athena_failed_calls_raw` / `_normalized` | `@/lib/read-model/athena-reconciliation` | Athena API failure ingest + match status |
| `crm_attendance_details` | `@/lib/read-model/attendance-details` | Technician activity mirror for admin report |
| `mis_client_import_rows` | `mis` client-import | Uploaded client MIS batches |
| `arcp_lines_hot` | `arcp-claims/sync` | ARCP claim lines hot cache |
| `cancelled_call_digest_recipients` | `mis-email/sync` | Per-branch cancelled digest To list |
| `subcontractor_stock_*` / `subcontractor_sap_mail_log` | `subcontractor-stock` | SAP reconcile config, runs, inbox log |
| `app_users` | Supabase + admin | Portal users, roles, preferences |
| `call_comments` | `calls` module | Portal-only triage notes |
| `call_flags` | `calls` module | Portal triage flags (noted/escalate/query) |
| `mis_email_routing_rules` | `mis-email` | Routing rule schedule + To/Cc |
| `mis_email_routing_send_log` | `mis-email` | Slot dedupe log |
| `major_repair_recipients` | `mis-email/sync` | Alert recipient rows per branch |
| `security_audit_log` | `@/lib/security` | All sensitive actions |
| CRM `trhcalls` | External CRM | Source of truth for all calls |

---

## 4. Permission Gates Summary

| Feature | Required Permission |
|---|---|
| MIS Summary tab | `tab_mis_summary` |
| MIS Register tab | `tab_mis_register` |
| MIS Accounts tab | `tab_mis_accounts` |
| ARCP Claims page | `page_arcp_claims` |
| Distribution page | `page_distribution` |
| Serial Audit | `page_serial_audit` |
| Location Audit | `page_location_audit` |
| Warranty Master | `page_warranty_master` |
| Athena failed-calls | `page_athena_reconciliation` |
| Cancelled Calls | `page_cancelled_calls` (also granted by `page_athena_reconciliation`) |
| MIS Email send | `mis_email_reports` |
| Mail & Alerts (routing, digests, subcontractor) | `page_mis_email_settings` |
| Service call activity | `manage_users` (hard-coded `/admin/attendance`) |
| Admin users | `manage_users` |
| VPS Cron manage | `super_admin` |
| Performance insights | `page_performance_insights` |
| HOD (all offices) | `view_all_offices` |

---

## 5. Module Quick-Reference

Per-module design notes: `src/modules/<name>/README.md`. MIS sub-leaves: `mis/register/`, `mis/client-import/`.

| Module | Path | Key responsibility |
|---|---|---|
| `auth` | `src/modules/auth` | Sign-in/out, /me, password reset |
| `mis` | `src/modules/mis` | Reports: summary, register, BD-MIS, client import |
| `calls` | `src/modules/calls` | Call detail drawer (CRM), comments, flags, offices |
| `mis-email` | `src/modules/mis-email` | Digest scheduler, compose, SMTP send, major-repair + cancelled-call alerts |
| `arcp-claims` | `src/modules/arcp-claims` | ARCP register + hybrid hot/CRM load |
| `sync` | `src/modules/sync` | Read-model status API, VPS cron pause API |
| `performance` | `src/modules/performance` | Web Vitals + server snapshot |
| `distribution` | `src/modules/distribution` | Call distribution + idle assignees |
| `serial-audit` | `src/modules/serial-audit` | Repeat complaint serial history |
| `location-audit` | `src/modules/location-audit` | Tech GPS vs install address |
| `warranty-master` | `src/modules/warranty-master` | Warranty coverage reports |
| `cancelled-calls` | `src/modules/cancelled-calls` | Cancelled register (Postgres), CSV/Excel export, digest data |
| `athena-reconciliation` | `src/modules/athena-reconciliation` | Athena API failure triage + reconcile UI |
| `attendance` | `src/modules/attendance` | Service call activity admin report |
| `subcontractor-stock` | `src/modules/subcontractor-stock` | SAP vs CRM stock reconcile + email (VPS) |
| `roles` | `src/modules/roles` | Role + permission admin UI |
| `users` | `src/modules/users` | User admin UI |
| `security-audit` | `src/modules/security-audit` | Audit log viewer |

---

## 6. Deployment / Infrastructure Diagram

> Where each piece physically runs and how they talk to each other.

```mermaid
flowchart LR
    subgraph DEV["① Developer machine"]
        LOCALDEV["npm run dev\nlocalhost:3000"]
        SCRIPTS["git push main\nSSH rsync deploy"]
    end

    subgraph VERCEL["② Vercel serverless"]
        NEXTAPP["Next.js SSR + API\nwrl-dashboard.vercel.app"]
    end

    subgraph SUPABASE["③ Supabase auth"]
        GOTRUE["GoTrue JWT"]
        POOLER["Connection pooler"]
        SUPADB[("app_users\nroles · permissions")]
        GOTRUE --- SUPADB
        POOLER --- SUPADB
    end

    subgraph VPS["④ Hostinger VPS · /opt/fast-close-app"]
        direction TB
        PG[("Postgres 15\nread-model hot tables")]
        SYNCWORKER["systemd sync-worker\n~3 min incremental"]
        NIGHTLY["systemd nightly timer\n02:30 IST sidecar"]
        MAILCRON["cron mail-scheduler\n*/15 MIS + subcontractor"]
        EVENINGOPS["cron evening-ops\n16:00 probes"]
        RELAY["mail-relay-server\n→ Postfix SMTP :25"]
        SYNCWORKER --> PG
        NIGHTLY --> PG
        MAILCRON --> PG
        MAILCRON --> RELAY
        EVENINGOPS --> RELAY
        EVENINGOPS --> PG
    end

    subgraph EXT["⑤ External"]
        USER(["Portal users"])
        CRM[("CRM trhcalls\nMS SQL")]
        GMAIL["Gmail SMTP\nlocal dev only"]
    end

    USER -->|HTTPS| NEXTAPP
    NEXTAPP -->|JWT + profile| POOLER
    NEXTAPP -->|READ_*_FROM=postgres| PG
    NEXTAPP -->|live drawer · serial| CRM
    NEXTAPP -->|HTTPS mail relay| RELAY
    RELAY -->|outbound email| USER

    SYNCWORKER -->|editedon delta| CRM
    NIGHTLY -->|nightly ETL| CRM

    SCRIPTS -->|CI deploy| NEXTAPP
    SCRIPTS -->|ops scripts| VPS
    LOCALDEV -.->|dev CRM / optional Gmail| CRM
    LOCALDEV -.-> GMAIL

    PG -.->|initial pg_dump| SUPADB

    style VERCEL fill:#111827,color:#f9fafb
    style VPS fill:#1e1b4b,color:#e0e7ff
    style SUPABASE fill:#14532d,color:#ecfdf5
    style EXT fill:#431407,color:#ffedd5
    style DEV fill:#1f2937,color:#f3f4f6
```

**Key facts:**
- Next.js runs on **Vercel** (serverless); no long-running processes.
- All background workers and crons run on the **Hostinger VPS**.
- Email from Vercel goes over HTTPS to a VPS relay server, which forwards via Postfix (avoids Vercel's SMTP restriction).
- **All outbound mail** (MIS, cancelled digest, major-repair, subcontractor) shares `sendDigestPayload()` / `sendHtmlEmail()` in `mis-email/services/send.ts`.
- Unified `*/15` mail cron: `mail-scheduler.sh` runs MIS digest + subcontractor steps (see [`MAIL_SCHEDULE.md`](MAIL_SCHEDULE.md)).
- Supabase handles **auth only** (GoTrue + app_users); the read-model Postgres is a separate VPS database.

---

## 7. Overall Data Flow / ETL

> Single picture: CRM → Postgres hot tables → Portal queries → Excel / Email output.

```mermaid
flowchart LR
    subgraph SOURCE["Source of Truth"]
        CRM[(CRM\ntrhcalls\nMS SQL)]
    end

    subgraph ETL["ETL — VPS Workers"]
        direction TB
        INCR["Incremental sync\n(every ~3 min)\nWatermark: editedon"]
        NIGHTLY["Nightly timer @ 02:30 IST\nYTD replay + athena + attendance\n+ cancelled register"]
        BACKFILL["One-time backfill\n(historical / gap fill)"]
        ARCP_SYNC["ARCP sync worker\n(arcp_lines_hot)"]
        ATHENA_SYNC["Athena failed-calls sync\n+ reconcile"]
        CANCEL_SYNC["Cancelled register sync\n→ calls_cancelled"]
        ATTEND_SYNC["Attendance details sync\n→ crm_attendance_details"]
        TRANSFORM["transform.ts\nnormalise · status_bucket\nbranch / region tags"]
        UPSERT["upsert hot tables\nON CONFLICT UPDATE"]
    end

    subgraph READMODEL["Postgres Read-Model (VPS)"]
        direction TB
        HOT[(calls_latest_hot)]
        CANCELHOT[(calls_cancelled)]
        ATHENAHOT[(athena_failed_calls_normalized)]
        ATTENDHOT[(crm_attendance_details)]
        ARCPHOT[(arcp_lines_hot)]
        IMPORTROWS[(mis_client_import_rows\nCoke · Mondelez)]
        AUDIT[(security_audit_log)]
        EMAILLOG[(mis_email_routing_send_log)]
        SUBCON[(subcontractor_stock_runs\nsubcontractor_sap_mail_log)]
    end

    subgraph PORTAL["Portal — Vercel / Next.js"]
        direction TB
        SUMMARY["querySummaryDashboard\n(regional + branch totals)"]
        REGISTER["queryDigestRegisterExport\n(call-level rows)"]
        TRACE["queryBdMisCrmCallTraceRows\n(BD-MIS traceable)"]
        CANCELREG["cancelled-calls query\n(summary · rows · CSV)"]
        ATHENAREP["athena-reconciliation\n(summary · rows · CSV)"]
        ACTIVITY["attendance activity report\n(admin)"]
        CALLBYID["postQuery CRM\n(single call detail drawer)"]
    end

    subgraph OUTPUT["Output"]
        BROWSER["Browser\n(tables, charts, KPIs)"]
        EXCEL["Excel workbooks\n(Summary · Register · Traceable\n· Cancelled digest · Subcontractor)"]
        EMAIL["MIS + cancelled + subcontractor email"]
        CSV["CSV exports\n(Register · ARCP · Cancelled · Athena)"]
        PDF["PDF\n(ARCP claims)"]
    end

    subgraph CLIENTIMPORT["Client Import (Browser upload)"]
        UPLOAD["Upload CSV/Excel\n(Coke · Mondelez)"]
        NORMALIZE["normalize + batch\n→ mis_client_import_rows"]
    end

    CRM -- "batch fetch\neditedon delta" --> INCR
    CRM -- "YTD + sidecar jobs" --> NIGHTLY
    CRM -- "gap fill" --> BACKFILL
    CRM -- "ARCP lines" --> ARCP_SYNC
    CRM -- "Athena failures" --> ATHENA_SYNC
    CRM -- "cancelled register" --> CANCEL_SYNC
    CRM -- "attendance rows" --> ATTEND_SYNC

    INCR --> TRANSFORM --> UPSERT --> HOT
    NIGHTLY --> HOT
    BACKFILL --> HOT
    ARCP_SYNC --> ARCPHOT
    ATHENA_SYNC --> ATHENAHOT
    CANCEL_SYNC --> CANCELHOT
    ATTEND_SYNC --> ATTENDHOT

    UPLOAD --> NORMALIZE --> IMPORTROWS

    HOT --> SUMMARY --> BROWSER
    HOT --> REGISTER --> BROWSER
    HOT --> TRACE
    CANCELHOT --> CANCELREG --> BROWSER
    ATHENAHOT --> ATHENAREP --> BROWSER
    ATTENDHOT --> ACTIVITY --> BROWSER
    IMPORTROWS -- "BD-MIS merge\n(Cadbury-safe)" --> TRACE
    ARCPHOT --> BROWSER
    SUBCON --> EXCEL

    SUMMARY --> EXCEL
    REGISTER --> EXCEL
    TRACE --> EXCEL
    CANCELREG --> EXCEL

    EXCEL --> EMAIL
    SUMMARY --> EMAIL
    TRACE -- "open-calls export" --> EMAIL
    CANCELREG --> EMAIL

    REGISTER --> CSV
    CANCELREG --> CSV
    ATHENAREP --> CSV
    ARCPHOT --> CSV
    ARCPHOT --> PDF

    CRM --> CALLBYID --> BROWSER

    style SOURCE fill:#3a1a1a,color:#fff
    style ETL fill:#1a1a3a,color:#eee
    style READMODEL fill:#1a2a1a,color:#eee
    style OUTPUT fill:#2a2a1a,color:#eee
    style CLIENTIMPORT fill:#2a1a2a,color:#eee
```

---

## 8. Background Jobs / Cron Map

> Every scheduled or daemon job, its schedule, pause flag, and log location.  
> **Mail-specific schedule:** [`MAIL_SCHEDULE.md`](MAIL_SCHEDULE.md) (canonical cron table).  
> **Sync CLI map:** [`SYNC_ENTRY_POINTS.md`](SYNC_ENTRY_POINTS.md).

```mermaid
flowchart LR
    subgraph DAEMON["systemd daemons (always-on)"]
        D1["fast-close-sync-worker\nIncremental sync every ~3 min\nRestart: always"]
        D2["fast-close-sync-worker-nightly\n02:30 IST: YTD + athena +\nattendance + cancelled register"]
    end

    subgraph CRON["cron (CRON_TZ=Asia/Kolkata)"]
        C1["*/15 daily\nMail scheduler\nmail-scheduler.sh\n(MIS + subcontractor)"]
        C2["09:50 Mon-Sat\nMorning watchdog\nmis-email-morning-watchdog.sh"]
        C4["16:00 daily\nEvening ops probe\nevening-ops-sequencer.sh"]
        C5["03:15 daily\nClient import purge\nmis-client-purge-old-files.sh"]
        C6["00:00 Sunday\nVACUUM FULL\nvacuum-full-mis-rows.sh"]
    end

    subgraph LOGS["Log files (VPS /opt/fast-close-app/logs/)"]
        L1[sync-worker.log]
        L2[sync-worker-nightly.log]
        L3[mail-scheduler.log]
        L4[mis-email-watchdog.log]
        L5[subcontractor output in mail-scheduler.log]
        L6[evening-ops-sequencer.log]
        L7[mis-client-purge.log]
        L8[vacuum-full.log]
    end

    D1 --> L1
    D2 --> L2
    C1 --> L3
    C2 --> L4
    C4 --> L6
    C5 --> L7
    C6 --> L8
```

| Job | Schedule (IST) | Days | Pause Flag | Log |
|---|---|---|---|---|
| **CRM incremental sync** | Every ~3 min (systemd daemon) | Mon–Sun | `crm_sync` (portal VPS Cron) | `logs/sync-worker.log` |
| **Nightly sidecar sync** | 02:30 (systemd timer) | Mon–Sun | — | `logs/sync-worker-nightly.log` |
| **Mail scheduler** (`mail-scheduler.sh`) | Every 15 min poll (cron) | Mon–Sun (MIS skips Sunday IST inside script) | `mis_email_digest` + `subcontractor_stock` per step | `logs/mail-scheduler.log` |
| **MIS email test digest** | Ad-hoc cron (optional) | Mon–Sat | `mis_email_test` (portal VPS Cron) | `logs/mis-email-cron.log` |
| **Morning watchdog** | 09:50 | Mon–Sat | — | `logs/mis-email-watchdog.log` |
| **Subcontractor stock** | Via mail-scheduler step 2 | Mon–Sun | `subcontractor_stock` (portal VPS Cron) | `logs/mail-scheduler.log` |
| **Evening ops probe** | 16:00 | Mon–Sun | Per-step in TS (`mis_email_test`, `cancelled_call_digest`, `subcontractor_stock`) | `logs/evening-ops-sequencer.log` |
| **Cancelled-call digest** | Via evening-ops (not standalone */15) | Mon–Sat | `cancelled_call_digest` | `logs/evening-ops-sequencer.log` |
| **Client import file purge** | 03:15 daily | Mon–Sun | — | `logs/mis-client-purge.log` |
| **VACUUM FULL** | 00:00 Sunday | Sun | — | `logs/vacuum-full.log` |
| **ARCP nightly sync** | Via `arcp-nightly.ps1` / CLI | Nightly | — | stdout |

```mermaid
flowchart TD
    subgraph CRONGATE["VPS Cron Gate (vps-cron-gate.sh)"]
        GATE{"isVpsCronPaused?\n(reads portal DB)"}
    end

    DIGESTCRON["cron: */15 daily\nmail-scheduler.sh"] --> GATE
    SUBCONCRON["mail-scheduler step 2\nsubcontractor-stock-cron.sh"] --> GATE
    GATE -- "paused=true" --> SKIP["exit 0 — no send"]
    GATE -- "paused=false" --> RUNDIGEST["tsx run-digest.ts\nrunMisEmailDigest()"]
    RUNDIGEST --> WINDOW{"IST send window\nhalf-open [anchor, anchor+15m)"}
    WINDOW -- "in window" --> SEND["compose + sendDigestPayload()"]
    WINDOW -- "out of window" --> SKIPRECIP["skip recipient (logged)"]

    SUBCONCRON --> SUBCONRUN["sync inbox → reconcile\n→ send at send_time_ist"]

    EVENINGOPS["cron: 16:00 daily\nevening-ops-sequencer.sh"] --> EVENINGGATE{"isVpsCronPaused?\n(per job id in TS)"}
    EVENINGGATE -- "paused" --> EVENSKIP["skip step (logged)"]
    EVENINGGATE -- "not paused" --> EVENINGSTEPS["MIS compose probe\n→ cancelled digest\n→ subcontractor probe\n→ midnight delta check"]

    WATCHDOG["cron: 09:50 Mon-Sat\nwatchdog.sh"] --> CHECK{"mail-scheduler.log\nhas today MIS digest complete?"}
    CHECK -- "yes" --> OK["exit 0 — all good"]
    CHECK -- "no" --> ALERT["send watchdog alert\nto admin email"]

    SYNCWORKER["systemd: fast-close-sync-worker\nrestart always"] --> LOCK{"acquireSyncLock\n(advisory Postgres lock)"}
    LOCK -- "held" --> WAIT["sleep 30s, retry"]
    LOCK -- "acquired" --> CRMDELTA["fetch CRM delta\ntransform → upsert"]
    CRMDELTA --> RELEASE["release lock"]
```

### Portal pause gates (bash vs TypeScript)

| Job / step | Pause ID | Bash gate (`vps-cron-gate.sh`) | TS gate (`isVpsCronPaused`) |
|---|---|---|---|
| MIS digest cron | `mis_email_digest` | Yes — `mis-email-digest.sh` | Inside `runMisEmailDigest` |
| Subcontractor cron | `subcontractor_stock` | Yes — `subcontractor-stock-cron.sh` | Inside subcontractor CLI |
| Mail scheduler | (per step above) | Delegates to child scripts | Delegates to child scripts |
| Evening ops — MIS test | `mis_email_test` | No | Yes — `evening-ops-sequencer.ts` |
| Evening ops — cancelled digest | `cancelled_call_digest` | No | Yes |
| Evening ops — subcontractor | `subcontractor_stock` | No | Yes |
| CRM sync worker | `crm_sync` | No (systemd) | N/A |

---

## 9. Key Tables — Simplified ERD

```mermaid
erDiagram
    app_users {
        uuid id PK
        text email
        text name
        text role
        text[] office_ids
        text[] visible_statuses
        jsonb mis_email_preferences
        boolean mis_email_enabled
        timestamptz created_at
    }

    roles {
        uuid id PK
        text name
        timestamptz created_at
    }

    permissions {
        uuid id PK
        text name
        text description
    }

    role_permissions {
        uuid role_id FK
        uuid permission_id FK
    }

    user_roles {
        uuid user_id FK
        uuid role_id FK
    }

    calls_latest_hot {
        bigint ncode PK
        text trn
        text nofficeid
        text status_bucket
        text client_name
        text region
        text branch
        date complaint_date
        text technician_name
        integer aging_days
        text priority
        timestamptz editedon
        timestamptz synced_at
    }

    arcp_lines_hot {
        bigint id PK
        text trn
        text nofficeid
        date bm_approved_at
        numeric claimed_amount
        numeric bm_approved_amount
        numeric ho_approved_amount
        text status
        timestamptz synced_at
    }

    mis_client_import_rows {
        bigint id PK
        uuid batch_id FK
        text source_code
        text client_name
        text status_bucket
        date complaint_date
        text region
        text branch
        timestamptz created_at
    }

    mis_client_import_batches {
        uuid id PK
        text source_code
        text filename
        integer row_count
        timestamptz uploaded_at
        timestamptz expires_at
    }

    mis_email_routing_rules {
        uuid id PK
        text zone
        text branch
        text client
        text[] to_emails
        text[] cc_emails
        boolean auto_send_enabled
        text schedule_anchor_time_ist
        integer schedule_interval_minutes
        text default_date_range
    }

    mis_email_routing_send_log {
        uuid id PK
        uuid rule_id FK
        text status
        text sent_to
        timestamptz sent_at
    }

    major_repair_recipients {
        uuid id PK
        text branch_id
        text email
        boolean enabled
        boolean is_hq
        timestamptz created_at
    }

    calls_cancelled {
        bigint id PK
        text trn
        text nofficeid
        date cancelled_date_ist
        text branch_name
        text call_type
        text cancel_reason
        timestamptz synced_at
    }

    athena_failed_calls_normalized {
        bigint id PK
        text status
        text failure_reason
        date call_date
        text serial_no
        text outlet_name
        timestamptz reconciled_at
    }

    crm_attendance_details {
        bigint id PK
        integer user_id
        integer office_id
        date activity_date
        text heading
        text unique_call
        timestamptz synced_at
    }

    cancelled_call_digest_recipients {
        uuid id PK
        text branch
        text email
        boolean enabled
    }

    subcontractor_stock_recipients {
        uuid id PK
        text recipient_name
        text email
        text plant_code
        boolean enabled
    }

    security_audit_log {
        uuid id PK
        text action
        text result
        jsonb actor
        jsonb target
        text summary
        jsonb metadata
        timestamptz created_at
    }

    call_flags {
        uuid id PK
        text trn
        text nofficeid
        text flag_type
        text set_by_user_id
        timestamptz created_at
    }

    call_comments {
        uuid id PK
        text trn
        text nofficeid
        text content
        text user_id
        timestamptz created_at
    }

    app_users ||--o{ user_roles : "has"
    roles ||--o{ user_roles : "grants"
    roles ||--o{ role_permissions : "has"
    permissions ||--o{ role_permissions : "in"
    mis_client_import_batches ||--o{ mis_client_import_rows : "contains"
    mis_email_routing_rules ||--o{ mis_email_routing_send_log : "logged by"
    calls_latest_hot ||--o{ call_flags : "flagged by"
    calls_latest_hot ||--o{ call_comments : "annotated by"
    calls_cancelled }o--|| calls_latest_hot : "may reference trn"
    athena_failed_calls_normalized }o--o| calls_latest_hot : "matched against"
```

---

## 10. RBAC Permission Decision Flow

> How every API request resolves access — from cookie to allow/deny.

```mermaid
flowchart TD
    REQ["Incoming Request\n(cookie or Bearer token)"] --> VERIFY

    VERIFY{"JWT verify\n@/lib/auth/server-user.ts"}
    VERIFY -- "invalid / expired" --> DENY401["401 Unauthorized\nor redirect /login"]
    VERIFY -- "valid JWT" --> LOADPROFILE

    LOADPROFILE["Load app_users profile\n+ expand role permissions\n(canonical DB names)"]
    LOADPROFILE --> SOFTTTL

    SOFTTTL{"Portal soft-timeout\n(cookie session TTL)"}
    SOFTTTL -- "expired" --> DENY401
    SOFTTTL -- "ok" --> OFFICESCOPE

    OFFICESCOPE{"office_ids check\nseesAllOffices?"}
    OFFICESCOPE -- "view_all_offices OR\nlegacy HOD role OR\noffice_ids is empty" --> SEESALL["HOD scope\n(all branches)"]
    OFFICESCOPE -- "non-empty office_ids" --> SCOPED["Branch scope\n(own offices only)"]

    SEESALL --> PAGECHECK
    SCOPED --> PAGECHECK

    PAGECHECK{"canAccessPage()\ncanAccessPath()"}
    PAGECHECK -- "no matching\npermission" --> DENY403["403 Forbidden\nor 404 hide"]
    PAGECHECK -- "permission found" --> TABCHECK

    TABCHECK{"Has tabs?\n(MIS Reports)"}
    TABCHECK -- "no tabs" --> ALLOW["200 Allow\n(full page/API access)"]
    TABCHECK -- "yes tabs" --> TABPERM

    TABPERM{"canAccessTab()\ntab_mis_* permission"}
    TABPERM -- "not permitted" --> DENY403
    TABPERM -- "permitted" --> SCOPEFILTER

    SCOPEFILTER["Apply office scope\nto SQL WHERE clause\n(assignedOffices filter)"]
    SCOPEFILTER --> ALLOW

    subgraph SPECIAL["Special gates"]
        SUPERADMIN["super_admin only:\n/admin/security-audit\n/admin/vps-cron (legacy → Mail hub)"]
        ADMINUSERS["manage_users:\n/admin/sync · /admin/attendance\n(rbac-catalog pages)"]
        MISEMAILCAP["mis_email_send capability:\nProfile email tab\nDigest recipients list"]
        MAILSETTINGS["page_mis_email_settings:\nMail & Alerts hub\n(incl. subcontractor tab)"]
        ATHENAALIAS["page_athena_reconciliation\nalso grants /report/cancelled-calls"]
        OFFICEDATA["canAccessOffice(nofficeid):\ncall-by-id drawer\ncomments + flags write"]
    end

    ALLOW -.-> SPECIAL
```

---

## 11. Failure & Degradation Paths

> What actually happens when each external dependency goes wrong.

```mermaid
flowchart TD
    subgraph CRM_FAIL["CRM unavailable / timeout"]
        direction LR
        CRMDOWN["CRM postQuery timeout\nor connection refused"]
        CRMDOWN --> HOTFALLBACK["calls_latest_hot still serves\nSummary + Register (stale)"]
        CRMDOWN --> CALLBYID_FAIL["Call detail drawer → 502/504\n(no hot fallback for full graph)"]
        CRMDOWN --> ARCP_CHUNK["ARCP: split weekly chunks\nretry each window\nnever skip a day"]
        CRMDOWN --> SYNCLOGS["Sync worker logs error\nretries on next 3-min cycle\nno data loss (watermark not advanced)"]
    end

    subgraph SYNC_LOCK["Sync lock held / stuck"]
        direction LR
        LOCKSTUCK["acquireSyncLock() blocked"]
        LOCKSTUCK --> SLEEPRETRY["sleep 30s → retry\nsystemd restarts if crash"]
        LOCKSTUCK --> STALEHOT["calls_latest_hot may drift\n(last sync still served)"]
        LOCKSTUCK --> MANUALFIX["Manual: SELECT pg_cancel_backend()\nor systemctl restart fast-close-sync-worker"]
    end

    subgraph SMTP_FAIL["SMTP / VPS email fails"]
        direction LR
        SMTPFAIL["Postfix / relay error\nor outbound disabled"]
        SMTPFAIL --> DIGESTFAIL["Any sendDigestPayload path\n→ failed[] + audit log"]
        SMTPFAIL --> WATCHDOG2["09:50 watchdog detects no send\n→ alert email to admin\n(via same relay — may also fail)"]
        SMTPFAIL --> NORETRY["No automatic retry of digest\n(next cron poll = next 15 min)"]
        SMTPFAIL --> DRYRUN["MIS_EMAIL_DRY_RUN=true\nlogs payload, skips SMTP"]
    end

    subgraph VPSCRON_PAUSE["VPS Cron paused from portal"]
        direction LR
        PAUSED["isVpsCronPaused() = true\n(portal DB flag)"]
        PAUSED --> SKIPALL["cron shell gate: exit 0\nno digest, no sync trigger"]
        PAUSED --> RESUMEUI["Resume via Mail & Alerts\n→ VPS Cron tab (super_admin)"]
    end

    subgraph POSTGRES_SLOW["Postgres VPS degraded"]
        direction LR
        PGDEG["High seq scan / temp spills\nor connection pool exhaustion"]
        PGDEG --> SLOWQUERIES["Dashboard queries slow\nor timeout (Vercel 10s limit)"]
        PGDEG --> VACUUMFIX["VACUUM ANALYZE\nor VACUUM FULL (Sunday cron)"]
        PGDEG --> INDEXES["Composite indexes:\ncalls_latest_hot (editedon, nofficeid)\nmis_client_import_rows (batch_id, source_code)"]
    end

    subgraph VERCEL_FAIL["Vercel deploy fails / timeout"]
        direction LR
        VFAIL["Build error or\nVPS not reachable"]
        VFAIL --> ROLLBACK["Vercel instant rollback\nto previous deployment"]
        VFAIL --> SKIPBRANCH["Non-main branches skipped\n(ignoreCommand in vercel.json)"]
        VFAIL --> VPSINDEP["VPS workers continue\nindependently of Vercel"]
    end

    subgraph SUPABASE_FAIL["Supabase auth degraded"]
        direction LR
        SFAIL["GoTrue unreachable\nor JWT verify fails"]
        SFAIL --> COOKIEFALLBACK["server-user.ts: cookie-embedded\nuser_id accepted as fallback\n(trusts cookie integrity)"]
        SFAIL --> LOGINBLOCK["sign-in page: returns 503\nno bypass"]
    end

    subgraph SAP_SUBCON_FAIL["SAP inbox / subcontractor stock"]
        direction LR
        SAPMISS["No SAP file for today\nor parse error"]
        SAPMISS --> SUBCONSKIP["cron logs SKIP\nno recipient email sent"]
        SAPMISS --> PORTALRELAY["Portal manual action\nrelays to VPS mail-relay"]
        CRMSTOCK["OLD_CRM_DATABASE_URL unset"]
        CRMSTOCK --> RECONPARTIAL["Reconcile may skip\nCRM stock comparison"]
    end

    subgraph ATHENA_CANCEL_FAIL["Athena / cancelled register stale"]
        direction LR
        SIDECARLAG["Nightly sidecar job failed\n(non-fatal logged)"]
        SIDECARLAG --> STALEATHENA["Athena report shows old failures"]
        SIDECARLAG --> STALECANCEL["Cancelled register lags CRM"]
        SIDECARLAG --> MANUALSYNC["POST reconcile/sync from UI\nor re-run nightly timer"]
    end
```

| Failure | Impact | Recovery |
|---|---|---|
| CRM down | Dashboard serves stale hot data; call drawer fails | Retry next sync cycle; no data loss |
| Sync lock stuck | Hot table drifts until lock released | `systemctl restart fast-close-sync-worker` or cancel Postgres backend |
| SMTP fail | Digest not sent; watchdog fires | Re-run via `npm run mis-email:preview` or next 15-min cron |
| VPS Cron paused | All cron jobs skip silently | Resume via `/admin/vps-cron` (super_admin) |
| Postgres slow | Dashboard timeouts; slow exports | Run VACUUM ANALYZE; check seq scan indexes |
| Vercel deploy fails | UI unreachable | Instant rollback; VPS workers unaffected |
| Supabase auth down | Login blocked; cookie sessions degrade | Cookie fallback for existing sessions |
| SAP file missing | Subcontractor emails skipped for the day | Wait for inbox sync; check `/tmp/extracted_sap` on VPS |
| Athena/cancelled sidecar lag | Reports show stale data | Re-run nightly timer or trigger sync from UI |
