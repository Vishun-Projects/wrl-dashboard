# Scope summary — WRL Portal

**Status:** Ready — scope derived from production codebase and deployed portal.

## In scope (delivered)

### Reporting

- MIS Reports: Summary, Call Register, Accounts, BD-MIS, Deployment Completion, client import (Coke/Cadbury)
- Call Distribution (franchisee map, idle assignees, KPIs)
- ARCP Claims register and export
- Serial Wise History (repeat complaints)
- Location Audit (visit vs install address)
- Warranty Master
- Cancelled Calls register (Postgres-backed)
- Failed Calls — Athena API reconciliation

### Mail and alerts

- Scheduled MIS email digests (personal preferences + routing rules)
- Major-repair repeat alerts (branch/HQ recipients)
- Cancelled-call daily digests
- Subcontractor stock reconciliation (SAP inbox → CRM match → email)

### Administration

- User management (portal accounts)
- Roles and page/tab permissions (RBAC)
- Mail & Alerts hub (org settings, routing, recipients)
- Read-model sync status on `/admin/sync` (manual **CRM sync → yesterday** on Call Register tab — `super_admin` only)
- Service call activity (attendance) report
- Performance insights
- Security audit log (super-admin)

### Platform

- Supabase authentication
- Office-scoped data access (branch managers see their branch unless granted national scope)
- Vercel-hosted web app + VPS workers (sync, mail, subcontractor)

## Out of scope

- CRM write-back (portal is read-only against MS SQL CRM)
- Mobile field-service app for technicians
- Real-time dispatch / live ops dashboard (read-model ~3 min lag)
- Hindi UI translation
- PDF export of this handover pack (use `07-Company-Share/PDF/`)

## Assumptions

- CRM and VPS Postgres remain available during business hours
- SMTP / mail relay configured on VPS per `PROD_READ_SOURCE.md`
- Portal users are created by admins; no self-registration

## Optional validation

Stakeholders may confirm (not blocking delivery):

1. The **in scope** list matches what WRL expected for this phase.
2. Anything in **out of scope** is deferred to a future phase by agreement.
3. Live RBAC matrix matches business intent (`04-RBAC/RBAC_MATRIX.xlsx`).

## Sources

| Date | Source | Requirement / decision |
|------|--------|------------------------|
| 2026-09-02 | Production portal | https://wrl-dashboard.vercel.app — deployed and in use |
| 2026-09-02 | Codebase (`main`) | Features listed in §In scope implemented in `src/modules/` |
| 2026-09-02 | [`FMS_Functional_Module_Spec.md`](../02-Functional/FMS_Functional_Module_Spec.md) | Functional behaviour reference |
| 2026-09-02 | Live DB export | RBAC roles and permissions in `04-RBAC/ROLES_SNAPSHOT.md` |

## Acceptance

Formal sign-off: [`06-Delivery/DELIVERY_STATEMENT.md`](../06-Delivery/DELIVERY_STATEMENT.md)

VPS host verification: [`05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md`](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md)
