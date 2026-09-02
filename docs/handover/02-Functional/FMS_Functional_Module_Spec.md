# Functional Module Specification — WRL Portal

> **Status:** Ready for IT / functional review (repo-generated from module READMEs + architecture). Describes what each module does today — not a stakeholder-signed requirements doc. Pair with [`BRD_WRL_Portal.md`](../01-Business/BRD_WRL_Portal.md) for business context.

Module-by-module functional reference. Technical implementation: `03-Technical/ARCHITECTURE.md`.

---

## mis — MIS Reports

| Field | Detail |
|-------|--------|
| **Purpose** | Primary ops reporting: Summary, Call Register, Accounts, BD-MIS, Deployment Completion, client import |
| **Users / roles** | `page_mis_reports` + tab permissions (`tab_mis_summary`, `tab_mis_register`, etc.) |
| **Screens** | `/report` (tabs under one page) |
| **Key actions** | Filter by date/branch/franchisee/status (role baseline on load; **Clear all** on register); export CSV/Excel; open TRN call drawer; upload client import files |
| **Data sources** | Postgres hot tables + CRM SQL for register/detail; client import in Postgres |
| **Scheduled jobs** | None (consumes read-model sync) |
| **RBAC** | Page `mis_reports`; tabs per MIS_TABS in RBAC matrix |

---

## mis-email — Mail & Alerts

| Field | Detail |
|-------|--------|
| **Purpose** | MIS digests, routing rules, major-repair alerts, cancelled-call digests; unified email send |
| **Users / roles** | `page_mis_email_settings` or OR-gate: `manage_users`, `manage_roles`, `view_all_offices`, legacy mail page perms |
| **Screens** | `/admin/mis-email-settings` (tabs: org, routing, major repair, cancelled, VPS cron, subcontractor) |
| **Key actions** | Configure outbound gate, routing rules, recipient lists; test send; view send tracker |
| **Data sources** | Postgres prefs/routing/recipient tables; report data via mis module services |
| **Scheduled jobs** | MIS digest `*/15` via `mail-scheduler.sh`; cancelled digest 16:00 IST (`evening-ops-sequencer.sh`); major-repair in sync worker (not cron) |
| **RBAC** | `page_mis_email_settings`, `page_major_repair_alerts`, `page_cancelled_call_alerts` (legacy paths) |

---

## subcontractor-stock — Subcontractor stock

| Field | Detail |
|-------|--------|
| **Purpose** | SAP inbox → CRM stock reconcile → discrepancy Excel → plant email |
| **Users / roles** | `page_mis_email_settings` (tab under Mail & Alerts) |
| **Screens** | `/admin/mis-email-settings?tab=subcontractor` |
| **Key actions** | Sync inbox, run reconciliation, send emails, manage skip rules and recipients |
| **Data sources** | SAP attachments (inbox), CRM stock query, Postgres config/history |
| **Scheduled jobs** | VPS CLI: inbox poll, auto-reconcile, IST send time |
| **RBAC** | Same as mis-email settings page |

---

## cancelled-calls — Cancelled Calls

| Field | Detail |
|-------|--------|
| **Purpose** | Cancelled call register from Postgres; CSV export; feeds cancelled digest |
| **Users / roles** | `page_cancelled_calls` |
| **Screens** | `/report/cancelled-calls` |
| **Key actions** | Filter, paginate, export CSV |
| **Data sources** | Postgres read-model (sync from CRM) |
| **Scheduled jobs** | Sync via read-model worker; digest via mis-email |
| **RBAC** | `page_cancelled_calls` |

---

## athena-reconciliation — Failed Calls (Athena API)

| Field | Detail |
|-------|--------|
| **Purpose** | CRM Athena ingestion failures matched to call register |
| **Users / roles** | `page_athena_reconciliation` |
| **Screens** | `/report/athena-reconciliation` |
| **Key actions** | View reconciliation rows; sync trigger via read-model |
| **Data sources** | Postgres + CRM fetch for Athena failures |
| **Scheduled jobs** | Read-model sync pipeline |
| **RBAC** | `page_athena_reconciliation` |

---

## attendance — Service call activity

| Field | Detail |
|-------|--------|
| **Purpose** | Technician activity report (admin) |
| **Users / roles** | `manage_users` (admin sync/attendance paths) |
| **Screens** | `/admin/attendance` |
| **Key actions** | Filter activity; CSV export |
| **Data sources** | Postgres attendance read-model |
| **Scheduled jobs** | Attendance sync in read-model worker |
| **RBAC** | `manage_users` |

---

## distribution — Call Distribution

| Field | Detail |
|-------|--------|
| **Purpose** | Franchisee map, idle assignees, distribution KPIs |
| **Users / roles** | `page_call_distribution` |
| **Screens** | `/report/distribution` |
| **Key actions** | Filter; view map/table; CSV export |
| **Data sources** | Postgres/CRM via shared MIS filters |
| **Scheduled jobs** | None |
| **RBAC** | `page_call_distribution` |

---

## arcp-claims — ARCP Claims

| Field | Detail |
|-------|--------|
| **Purpose** | ARCP claims register and detail export |
| **Users / roles** | `page_arcp_claims` |
| **Screens** | `/report/arcp-claims` |
| **Key actions** | Browse register; export |
| **Data sources** | CRM / Postgres per module queries |
| **Scheduled jobs** | None |
| **RBAC** | `page_arcp_claims` |

---

## serial-audit — Serial Wise History

| Field | Detail |
|-------|--------|
| **Purpose** | Repeat serial complaints and repair audit |
| **Users / roles** | `page_serial_audit` |
| **Screens** | `/report/serial-audit` |
| **Key actions** | Search serial; expand history; CSV export |
| **Data sources** | CRM + hot read-model |
| **Scheduled jobs** | None |
| **RBAC** | `page_serial_audit` |

---

## location-audit — Location Audit

| Field | Detail |
|-------|--------|
| **Purpose** | Technician visit location vs customer install address |
| **Users / roles** | `page_location_audit` |
| **Screens** | `/report/location-audit` |
| **Key actions** | Flag mismatches; filter; export |
| **Data sources** | CRM geo + install data |
| **Scheduled jobs** | None |
| **RBAC** | `page_location_audit` |

---

## warranty-master — Warranty Master

| Field | Detail |
|-------|--------|
| **Purpose** | Active machines by customer, group, warranty period |
| **Users / roles** | `page_warranty_master` |
| **Screens** | `/report/warranty-master` |
| **Key actions** | Filter; browse; export |
| **Data sources** | CRM |
| **Scheduled jobs** | None |
| **RBAC** | `page_warranty_master` |

---

## users — User Management

| Field | Detail |
|-------|--------|
| **Purpose** | Create and edit portal users |
| **Users / roles** | `manage_users` |
| **Screens** | `/admin/users` |
| **Key actions** | CRUD users; assign role; office scope; enable MIS email |
| **Data sources** | Supabase auth + `app_users` Postgres |
| **Scheduled jobs** | None |
| **RBAC** | `manage_users` |

---

## roles — Roles & Access

| Field | Detail |
|-------|--------|
| **Purpose** | Define roles and page/tab/capability permissions |
| **Users / roles** | `manage_roles` |
| **Screens** | `/admin/roles` |
| **Key actions** | Edit role permission matrix; hierarchical MIS tabs |
| **Data sources** | `app_roles`, `app_role_permissions` |
| **Scheduled jobs** | None |
| **RBAC** | `manage_roles` |

---

## auth — Authentication

| Field | Detail |
|-------|--------|
| **Purpose** | Login, session, password flows |
| **Users / roles** | All users |
| **Screens** | `/login`, `/profile` |
| **Key actions** | Sign in/out; update profile (name, avatar, theme, password); MIS email prefs if granted |
| **Data sources** | Supabase |
| **Scheduled jobs** | None |
| **RBAC** | Session-based; landing page from first permitted route |

---

## sync — Read-model sync (admin)

| Field | Detail |
|-------|--------|
| **Purpose** | Sync status dashboard (admin) |
| **Users / roles** | `manage_users` for `/admin/sync` view |
| **Screens** | `/admin/sync` |
| **Key actions** | View worker status; refresh status |
| **Data sources** | VPS workers + Postgres read-model tables |
| **Scheduled jobs** | systemd sync workers on VPS (see SYNC_ENTRY_POINTS) |
| **RBAC** | `manage_users`. Manual **CRM sync → yesterday** is on `/report` Call Register tab — **`super_admin` only** (`/api/admin/calls-hot-sync`) |

---

## security-audit — Activity log

| Field | Detail |
|-------|--------|
| **Purpose** | Privileged action audit trail |
| **Users / roles** | `super_admin` capability |
| **Screens** | `/admin/security-audit` (Activity Log in sidebar Admin section) |
| **Key actions** | Search audit events |
| **Data sources** | Postgres audit log |
| **Scheduled jobs** | None |
| **RBAC** | `super_admin` |

---

## performance — Performance Insights

| Field | Detail |
|-------|--------|
| **Purpose** | Client performance metrics and diagnostics |
| **Users / roles** | `page_performance_insights` |
| **Screens** | `/admin/performance-insights` |
| **Key actions** | View metrics; diagnostics |
| **Data sources** | Client-side performance collection |
| **Scheduled jobs** | None |
| **RBAC** | `page_performance_insights` |

---

## calls — Call detail API

| Field | Detail |
|-------|--------|
| **Purpose** | Live CRM call drawer data, offices list, comments |
| **Users / roles** | `tab_mis_register` (Call Register tab) + office scope |
| **Screens** | Call drawer from Call Register (not standalone page) |
| **Key actions** | Fetch call detail; post comments; flags |
| **Data sources** | CRM live + Postgres flags/comments |
| **Scheduled jobs** | None |
| **RBAC** | `resolveReportSecurity` with `pageId: mis_reports`, `tabId: register` |

---

## Cross-cutting

| Concern | Where documented |
|---------|------------------|
| RBAC catalog | `04-RBAC/`, `src/lib/auth/rbac-catalog.ts` |
| Read-model workers | `05-Operations/SYNC_ENTRY_POINTS.md` |
| Mail cron | `05-Operations/MAIL_SCHEDULE.md` |
| Prod env | `05-Operations/PROD_READ_SOURCE.md` |
