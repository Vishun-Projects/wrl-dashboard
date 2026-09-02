# Business Requirements Document — WRL Portal

| Field | Value |
|-------|-------|
| **Version** | Production handover v1 |
| **Date** | 2026-09-02 |
| **Author** | Delivery team |
| **Approvers** | Sunil (business sponsor), Rakesh / VP (acceptance) |

## 1. Executive summary

**WRL Portal** is an internal web application for **Western Refrigeration Pvt. Ltd.** It provides MIS reporting, audit registers, automated email digests, and user/role administration on top of existing CRM service-call data. The portal does not replace the CRM; it reads CRM and local Postgres read-models to give branches and headquarters faster visibility for month-end close and daily operations.

Production: **https://wrl-dashboard.vercel.app**

---

## 2. Stakeholders

| Role | Name | Interest |
|------|------|----------|
| Business sponsor | Sunil | MIS close, branch visibility, digest routing |
| Acceptance authority | Rakesh / VP | Formal sign-off on delivered scope |
| HOD / MIS ops | Portal HOD role holders | National reports, BD-MIS, mail digests |
| Branch managers | Portal BM role holders | Branch-scoped registers and exports |
| IT / ops | Delivery + VPS ops | VPS workers, cron, env, read-model sync |
| Portal admins | Users with `manage_users`, `manage_roles`, or Mail & Alerts grants | User/role/mail configuration |

### 2.1 Configured portal roles

Live role configuration (user counts and permissions) is exported from production on each handover run:

- [`04-RBAC/ROLES_SNAPSHOT.md`](../04-RBAC/ROLES_SNAPSHOT.md)
- [`04-RBAC/RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx)

Edit roles in `/admin/roles`, then re-run `npm run handover:export` to refresh.

---

## 3. Business objectives

1. **Faster MIS close** — Summary, register, and accounts views with consistent open/solved math and Excel export.
2. **Branch visibility** — Office-scoped filters; optional national scope for HOD roles.
3. **Audit trails** — Serial, location, ARCP, warranty, cancelled-call, and Athena reconciliation registers.
4. **Automated digests** — MIS email, major-repair alerts, cancelled-call digests without manual copy-paste.
5. **Controlled access** — Role-based pages and tabs; admin-managed users.

---

## 4. Scope

### In scope

See [`SCOPE_SUMMARY.md`](SCOPE_SUMMARY.md) for the detailed in/out list.

### Out of scope

- CRM data entry or status changes from the portal
- Mobile technician app
- Sub-second real-time CRM mirror

---

## 5. User personas and journeys

### Branch manager

1. Log in → land on MIS Reports (or first permitted page).
2. Set date range and branch filters → view Summary tab.
3. Open Call Register → click TRN for live CRM call detail drawer.
4. Export register or summary to Excel/CSV.

### HOD / MIS

1. Log in with national or multi-office scope.
2. Review BD-MIS and Accounts with client import merge (Coke/Cadbury rules).
3. Configure or receive scheduled MIS digests (if granted MIS email capability).
4. Review distribution, cancelled calls, or Athena failures as needed.

### Portal administrator

1. Create users and assign roles in **User Management** / **Roles & Access**.
2. Configure **Mail & Alerts** — org outbound gate, routing rules, major-repair and cancelled recipients, subcontractor stock.
3. Monitor read-model sync on **Read-model sync** admin page.

---

## 6. Functional requirements (summary)

| ID | Requirement |
|----|-------------|
| BR-01 | Authenticated users access only pages/tabs granted by role |
| BR-02 | MIS filters initialize to role baseline (branch scope); user adjusts per session; **Clear all** on Call Register |
| BR-03 | MIS counts match between UI, export, and email digest (Cadbury-safe rules for mail) |
| BR-04 | Call detail drawer loads live CRM data for a TRN |
| BR-05 | Admins manage users, roles, and mail settings without code deploy |
| BR-06 | Scheduled jobs on VPS send digests and run read-model sync per documented cron |
| BR-07 | Security audit log for privileged actions (super-admin) |

Detailed module behaviour: [`02-Functional/FMS_Functional_Module_Spec.md`](../02-Functional/FMS_Functional_Module_Spec.md).

---

## 7. Non-functional requirements

| Area | Requirement |
|------|-------------|
| **Authentication** | Supabase email/password; session on Vercel |
| **Authorization** | Application RBAC (`rbac-catalog`); office scope on queries |
| **Data freshness** | Read-model hot tables ~3 min behind CRM; drawer is live CRM |
| **Hosting** | Vercel (app) + Hostinger VPS (Postgres workers, mail, subcontractor) |
| **Availability** | Best-effort; VPS Postgres is single-node (see known limitations) |
| **Email** | Unified send path via MIS email module; relay on Vercel, SMTP on VPS |

---

## 8. Dependencies and assumptions

- MS SQL CRM reachable from VPS sync workers
- VPS Postgres schema applied (`db:apply-read-model`)
- SMTP or relay credentials configured
- Supabase project for auth and `app_users` / roles tables

---

## 9. Acceptance criteria

- [ ] VPS environment checklist completed on production host (`05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md`)
- [ ] RBAC validated against live matrix (`04-RBAC/RBAC_MATRIX.xlsx`, `ROLES_SNAPSHOT.md`)
- [ ] Production URL accessible for agreed pilot users
- [ ] Formal sign-off recorded (`06-Delivery/DELIVERY_STATEMENT.md` §Sign-off)

---

## 10. Delivered requirements

| ID | Requirement | Evidence | Status |
|----|-------------|----------|--------|
| BR-01 | Role-based page/tab access | [`RBAC_DECISION_FLOW.md`](../04-RBAC/RBAC_DECISION_FLOW.md), live [`RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx) | Delivered |
| BR-02 | Role-baseline filters + in-session filter edits | FMS §mis, `ReportFiltersContext.tsx` | Delivered |
| BR-03 | MIS count consistency (UI/export/mail) | FMS §MIS email, [`MAIL_SCHEDULE.md`](../05-Operations/MAIL_SCHEDULE.md) | Delivered |
| BR-04 | Live CRM call drawer | FMS §Call drawer, `/api/calls/[id]` | Delivered |
| BR-05 | Admin user/role/mail without deploy | FMS §Administration, `/admin/*` routes | Delivered |
| BR-06 | VPS cron sync and mail | [`SYNC_ENTRY_POINTS.md`](../05-Operations/SYNC_ENTRY_POINTS.md), [`MAIL_SCHEDULE.md`](../05-Operations/MAIL_SCHEDULE.md) | Delivered |
| BR-07 | Security audit log | FMS §Security audit, `super_admin` capability | Delivered |

---

## Related documents

- [`SCOPE_SUMMARY.md`](SCOPE_SUMMARY.md)
- [`FMS_Functional_Module_Spec.md`](../02-Functional/FMS_Functional_Module_Spec.md)
- [`ARCHITECTURE.md`](../03-Technical/ARCHITECTURE.md)
- [`KNOWN_ISSUES_AND_LIMITATIONS.md`](../05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md)
