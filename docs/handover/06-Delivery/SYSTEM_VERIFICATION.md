# System verification — WRL Portal

> **Generated:** 2026-09-02T05:51:55Z · Regenerate: `npm run handover:export`

Factual snapshot of the **production** portal configuration. VPS host checks require SSH — see [`VPS_ENV_VERIFICATION_CHECKLIST.md`](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md).

## Production identity

| Item | Value |
| --- | --- |
| Portal URL | https://wrl-dashboard.vercel.app |
| Package | fast-close-app@0.1.0 |
| Git | `4cd6dee` on `main` |
| Export date | 2026-09-02 |

## Portal users and roles (live DB)

| Metric | Count |
| --- | ---: |
| Active portal users | 16 |
| Configured roles | 6 |
| Roles with assigned users | 4 |
| Role-permission grants | 89 |

### Users per role

| Role | Users |
| --- | ---: |
| BM - Serial Audit | 6 |
| Branch Manager | 1 |
| HOD | 5 |
| View Summary | 4 |

Full permission lists: [`04-RBAC/ROLES_SNAPSHOT.md`](../04-RBAC/ROLES_SNAPSHOT.md) · Excel: [`RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx).

## Application surface (from codebase)

| Item | Count |
| --- | ---: |
| RBAC pages (catalog) | 18 |
| Sidebar nav pages | 12 |
| MIS tabs | 6 |
| API routes | 78 |

## Documentation present in handover pack

- [ ] `05-Operations/PROD_READ_SOURCE.md` included in pack
- [ ] `05-Operations/MAIL_SCHEDULE.md` included in pack
- [ ] `05-Operations/SYNC_ENTRY_POINTS.md` included in pack
- [ ] `03-Technical/API_REFERENCE.md` auto-generated from routes
- [ ] `04-RBAC/RBAC_MATRIX.xlsx` exported from production DB

## VPS / ops (requires SSH to confirm)

Complete on the production host:

- [ ] [`VPS_ENV_VERIFICATION_CHECKLIST.md`](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md)
- [ ] `READ_*_FROM=postgres` flags match [`PROD_READ_SOURCE.md`](../05-Operations/PROD_READ_SOURCE.md)
- [ ] Cron: `mail-scheduler.sh`, sync workers per [`MAIL_SCHEDULE.md`](../05-Operations/MAIL_SCHEDULE.md) and [`SYNC_ENTRY_POINTS.md`](../05-Operations/SYNC_ENTRY_POINTS.md)
- [ ] Postgres backup procedure — **not documented in repo**; ops to define (see [`docs/sync.md`](../../sync.md) rollback note)

## Related

- [`DELIVERY_STATEMENT.md`](DELIVERY_STATEMENT.md) — deliverables and sign-off request
- [`FMS_Functional_Module_Spec.md`](../02-Functional/FMS_Functional_Module_Spec.md)
