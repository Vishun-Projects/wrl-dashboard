# API Reference

Generated: 2026-09-02 from `src/app/api/**/route.ts`.

## Admin

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/admin/attendance` | session | @/modules/attendance/server/routes/list |
| GET, PUT | `/api/admin/attendance-settings` | session | @/modules/attendance/server/routes/settings |
| GET | `/api/admin/bootstrap` | session | @/modules/users/server/routes/bootstrap |
| POST | `/api/admin/calls-hot-sync` | session | @/modules/sync/server/routes/calls-hot-sync |
| GET, PUT, POST | `/api/admin/cancelled-call-digest` | canAccessPage | @/modules/mis-email/server/routes/cancelled-call-digest |
| GET, POST, PUT, DELETE | `/api/admin/cancelled-call-digest-recipients` | page:cancelled_call_alerts | @/modules/mis-email/server/routes/cancelled-call-digest-recipients |
| GET, POST, PUT, DELETE | `/api/admin/major-repair-alert-recipients` | page:major_repair_alerts | @/modules/mis-email/server/routes/major-repair-recipients |
| GET, PUT | `/api/admin/mis-email-org-settings` | session | @/modules/mis-email/server/routes/org-settings |
| GET, POST, PUT, DELETE | `/api/admin/mis-email-routing` | session | @/modules/mis-email/server/routes/routing |
| GET | `/api/admin/mis-email-routing/options` | session | @/modules/mis-email/server/routes/routing-options |
| GET | `/api/admin/mis-email-schedules` | session | @/modules/mis-email/server/routes/schedules |
| GET, PATCH | `/api/admin/mis-email-user-prefs` | session | @/modules/mis-email/server/routes/user-prefs |
| GET, POST | `/api/admin/mis-email/test` | session | @/modules/mis-email/server/routes/mis-email-test |
| GET, POST | `/api/admin/performance-log` | session | @/modules/performance/server/routes/performance-log |
| GET | `/api/admin/performance-snapshot` | session | @/modules/performance/server/routes/performance-snapshot |
| GET, POST, PUT, DELETE | `/api/admin/roles` | session | @/modules/roles/server/routes/roles |
| GET | `/api/admin/security-audit` | session | @/modules/security-audit/server/routes/security-audit |
| GET, POST, PUT, DELETE | `/api/admin/subcontractor-stock-settings` | canAccessPage | @/modules/subcontractor-stock/server/routes/settings |
| GET, POST, PUT, DELETE | `/api/admin/users` | session | @/modules/users/server/routes/users |
| POST | `/api/admin/users/password` | session | @/modules/users/server/routes/password |
| GET, PATCH | `/api/admin/vps-cron` | session | @/modules/sync/server/routes/vps-cron |
## Auth

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/auth/complete-password-reset` | session | @/modules/auth/server/routes/complete-password-reset |
| POST | `/api/auth/forgot-password` | session | @/modules/auth/server/routes/forgot-password |
| GET | `/api/auth/me` | session | @/modules/auth/server/routes/me |
| POST | `/api/auth/sign-in` | Bearer/cron, session | @/modules/auth/server/routes/sign-in |
| POST | `/api/auth/sign-out` | session | @/modules/auth/server/routes/sign-out |
## Calls / comments / flags

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/calls/[id]` | page:mis_reports, tab:register | @/modules/calls/server/routes/call-by-id |
| GET, POST | `/api/comments` | page:mis_reports, tab:register | @/modules/calls/server/routes/comments |
| POST | `/api/flags` | page:mis_reports, tab:register, Bearer/cron | @/modules/calls/server/routes/flags |
## Other

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| DELETE | `/api/mis-client-import/batches/[batchId]` | page:mis_reports | @/modules/mis/server/routes/mis-import-batches-batchId |
| GET | `/api/mis-client-import/batches/[batchId]/download` | page:mis_reports | @/modules/mis/server/routes/mis-import-batches-batchId-download |
| GET | `/api/mis-client-import/meta` | page:mis_reports | @/modules/mis/server/routes/mis-import-meta |
| GET, POST | `/api/mis-client-import/sources` | page:mis_reports | @/modules/mis/server/routes/mis-import-sources |
| GET, PUT | `/api/mis-client-import/sources/[code]` | page:mis_reports | @/modules/mis/server/routes/mis-import-sources-code |
| GET | `/api/mis-client-import/summary` | page:mis_reports | @/modules/mis/server/routes/mis-import-summary |
| POST | `/api/mis-client-import/upload` | page:mis_reports | @/modules/mis/server/routes/mis-import-upload |
| GET, POST | `/api/mis-client-import/upload-chunk` | page:mis_reports | @/modules/mis/server/routes/mis-import-upload-chunk |
| GET | `/api/offices` | page:mis_reports, RBAC | @/modules/calls/server/routes/offices |
## Profile / MIS email

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| PATCH | `/api/profile` | session | @/modules/users/server/routes/profile |
| GET, POST | `/api/profile/avatar` | session | @/modules/users/server/routes/profile-avatar |
| GET, PATCH | `/api/profile/mis-email` | session | @/modules/mis-email/server/routes/profile-prefs |
| GET | `/api/profile/mis-email/accounts` | session | @/modules/mis-email/server/routes/profile-accounts |
| POST | `/api/profile/mis-email/preview` | session | @/modules/mis-email/server/routes/profile-preview |
| POST | `/api/profile/mis-email/send` | session | @/modules/mis-email/server/routes/profile-send |
| GET | `/api/profile/mis-email/send/status` | session | @/modules/mis-email/server/routes/profile-send-status |
| POST | `/api/profile/password` | session | @/modules/users/server/routes/profile-password |
## Read model / sync

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/read-model/status` | session | @/modules/sync/server/routes/read-model-status |
## Reports

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/report` | session | @/modules/mis/server/routes/report |
| GET | `/api/report/arcp-claims` | session | @/modules/arcp-claims/server/routes/aggregates |
| GET | `/api/report/arcp-claims/detail` | session | @/modules/arcp-claims/server/routes/detail |
| GET | `/api/report/arcp-claims/detail/export` | session | @/modules/arcp-claims/server/routes/detail-export |
| GET | `/api/report/arcp-claims/label-lookups` | session | @/modules/arcp-claims/server/routes/label-lookups |
| POST | `/api/report/arcp-claims/load-start` | session | @/modules/arcp-claims/server/routes/load-start |
| GET | `/api/report/arcp-claims/load-status` | session | @/modules/arcp-claims/server/routes/load-status |
| GET, POST | `/api/report/athena-reconciliation` | page:athena_reconciliation | @/modules/athena-reconciliation/server/routes/athena-reconciliation |
| GET | `/api/report/bd-mis-summary` | page:mis_reports, tab:bd_mis_summary | @/modules/mis/server/routes/bd-mis-summary |
| GET | `/api/report/call-register` | page:mis_reports, tab:deployment_completion | @/modules/mis/server/routes/call-register |
| GET | `/api/report/call-register/serials` | page:mis_reports, tab:deployment_completion | @/modules/mis/server/routes/call-register-serials |
| GET, PUT | `/api/report/call-register/visible-clients` | page:mis_reports, tab:deployment_completion | @/modules/mis/server/routes/call-register-visible-clients |
| GET | `/api/report/call-types` | page:mis_reports | @/modules/mis/server/routes/call-types |
| GET | `/api/report/cancelled-calls` | page:cancelled_calls | @/modules/cancelled-calls/server/routes/cancelled-calls |
| GET | `/api/report/corpus` | page:mis_reports, tab:register | @/modules/mis/server/routes/corpus |
| GET | `/api/report/distribution/summary` | page:call_distribution | @/modules/distribution/server/routes/summary |
| POST | `/api/report/drilldown` | page:mis_reports, tab:register | @/modules/mis/server/routes/drilldown |
| GET | `/api/report/engineers` | page:mis_reports, tab:register | @/modules/mis/server/routes/engineers |
| GET | `/api/report/filter-options` | session | @/modules/mis/server/routes/filter-options |
| GET | `/api/report/location-audit` | page:location_audit | @/modules/location-audit/server/routes/location-audit |
| GET | `/api/report/portal-audit` | page:mis_reports, tab:register | @/modules/mis/server/routes/portal-audit |
| GET | `/api/report/serial-audit` | page:serial_audit | @/modules/serial-audit/server/routes/serial-audit |
| POST | `/api/report/serial-audit/batch` | page:serial_audit | @/modules/serial-audit/server/routes/batch |
| GET, POST | `/api/report/serial-audit/involvement` | page:serial_audit | @/modules/serial-audit/server/routes/involvement |
| GET | `/api/report/serial-audit/repair-call-ids` | page:serial_audit | @/modules/serial-audit/server/routes/repair-call-ids |
| GET | `/api/report/serial-audit/repair-counts` | page:serial_audit | @/modules/serial-audit/server/routes/repair-counts |
| GET | `/api/report/serial-audit/repairs` | page:serial_audit, tab:register | @/modules/serial-audit/server/routes/repairs |
| GET | `/api/report/summary` | page:mis_reports, tab:summary | @/modules/mis/server/routes/summary |
| GET | `/api/report/totals` | session | @/modules/mis/server/routes/totals |
| GET | `/api/report/warranty-master` | page:warranty_master | @/modules/warranty-master/server/routes/warranty-master |
## Other

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/security-audit/client-action` | session | @/modules/security-audit/server/routes/client-action |
