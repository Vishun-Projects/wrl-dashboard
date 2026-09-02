# Portal roles snapshot (production DB)

> **Generated:** 2026-09-02T05:51:55Z from `app_roles`, `app_role_permissions`, `app_users`. Regenerate: `npm run handover:export`.

This is the **live** role configuration in the portal database — not a workshop template.

## Roles

| Role | Active users | Description |
| --- | ---: | --- |
| BM - Serial Audit | 6 | Branch manager could see only serial wise page |
| Branch Manager | 1 | Manager with access to specific branch data |
| HOD | 5 | Head of Department with full system access |
| Mail access | 0 | Compose/send MIS email reports (Summary, Call Register, Key Account) |
| Super Admin | 0 | Full portal access including privileged Super Admin controls |
| View Summary | 4 | — |

## Permissions by role

### BM - Serial Audit

- `page_athena_reconciliation` — page: Failed Calls - Athena API
- `page_cancelled_calls` — page: Cancelled Calls
- `page_serial_audit` — page: Serial Wise History

### Branch Manager

- `mis_client_import_delete` — capability: Delete client imports
- `mis_client_import_upload` — capability: Import client MIS files
- `mis_email_send`
- `page_arcp_claims` — page: ARCP Claims
- `page_athena_reconciliation` — page: Failed Calls - Athena API
- `page_call_distribution` — page: Call Distribution
- `page_cancelled_calls` — page: Cancelled Calls
- `page_location_audit` — page: Location Audit
- `page_mis_reports` — page: MIS Reports
- `page_serial_audit` — page: Serial Wise History
- `page_warranty_master` — page: Warranty Master
- `tab_mis_accounts` — tab: Key Account MIS
- `tab_mis_bd_mis_summary` — tab: Cadbury+Coke+CRM Summary Dashboard
- `tab_mis_client_import` — tab: Client Import
- `tab_mis_register` — tab: Call Register
- `tab_mis_summary` — tab: Summary Dashboard

### HOD

- `delete_calls`
- `manage_roles` — page: Roles & Access
- `manage_users` — pages: User Management, Read-model sync, Service call activity
- `mis_client_import_delete` — capability: Delete client imports
- `mis_client_import_upload` — capability: Import client MIS files
- `mis_email_send`
- `page_arcp_claims` — page: ARCP Claims
- `page_athena_reconciliation` — page: Failed Calls - Athena API
- `page_call_distribution` — page: Call Distribution
- `page_cancelled_call_alerts` — page: Cancelled Call Digests
- `page_cancelled_calls` — page: Cancelled Calls
- `page_location_audit` — page: Location Audit
- `page_mis_reports` — page: MIS Reports
- `page_performance_insights` — page: Performance Insights
- `page_serial_audit` — page: Serial Wise History
- `page_warranty_master` — page: Warranty Master
- `tab_mis_accounts` — tab: Key Account MIS
- `tab_mis_bd_mis_summary` — tab: Cadbury+Coke+CRM Summary Dashboard
- `tab_mis_client_import` — tab: Client Import
- `tab_mis_register` — tab: Call Register
- `tab_mis_summary` — tab: Summary Dashboard

### Mail access

- `mis_email_send`
- `tab_mis_accounts` — tab: Key Account MIS
- `tab_mis_register` — tab: Call Register
- `tab_mis_summary` — tab: Summary Dashboard

### Super Admin

- `delete_calls`
- `manage_roles` — page: Roles & Access
- `manage_users` — pages: User Management, Read-model sync, Service call activity
- `mis_client_import_delete` — capability: Delete client imports
- `mis_client_import_upload` — capability: Import client MIS files
- `mis_email_send`
- `page_arcp_claims` — page: ARCP Claims
- `page_athena_reconciliation` — page: Failed Calls - Athena API
- `page_call_distribution` — page: Call Distribution
- `page_cancelled_call_alerts` — page: Cancelled Call Digests
- `page_cancelled_calls` — page: Cancelled Calls
- `page_location_audit` — page: Location Audit
- `page_major_repair_alerts` — page: Major Repair Alerts
- `page_mis_email_routing` — page: MIS Email Routing
- `page_mis_email_settings` — page: Mail & Alerts
- `page_mis_reports` — page: MIS Reports
- `page_performance_insights` — page: Performance Insights
- `page_serial_audit` — page: Serial Wise History
- `page_warranty_master` — page: Warranty Master
- `super_admin` — page: VPS Cron
- `tab_mis_accounts` — tab: Key Account MIS
- `tab_mis_bd_mis_summary` — tab: Cadbury+Coke+CRM Summary Dashboard
- `tab_mis_client_import` — tab: Client Import
- `tab_mis_deployment_completion` — tab: Deployment Completion
- `tab_mis_register` — tab: Call Register
- `tab_mis_summary` — tab: Summary Dashboard
- `view_all_offices` — capability: View all offices
- `view_calls`
- `view_mis_accounts`
- `view_mis_register`
- `view_mis_summary`
- `view_reports`
- `view_summary`

### View Summary

- `mis_client_import_delete` — capability: Delete client imports
- `mis_client_import_upload` — capability: Import client MIS files
- `mis_email_send`
- `page_athena_reconciliation` — page: Failed Calls - Athena API
- `page_cancelled_calls` — page: Cancelled Calls
- `page_mis_reports` — page: MIS Reports
- `page_serial_audit` — page: Serial Wise History
- `tab_mis_accounts` — tab: Key Account MIS
- `tab_mis_bd_mis_summary` — tab: Cadbury+Coke+CRM Summary Dashboard
- `tab_mis_client_import` — tab: Client Import
- `tab_mis_register` — tab: Call Register
- `tab_mis_summary` — tab: Summary Dashboard

## Matrix export

Full permission × role grid: [`RBAC_MATRIX.xlsx`](RBAC_MATRIX.xlsx) sheet **RoleMatrix**.

## Related

- [RBAC_DECISION_FLOW.md](RBAC_DECISION_FLOW.md) — how authz is enforced
- Roles UI: `/admin/roles`
