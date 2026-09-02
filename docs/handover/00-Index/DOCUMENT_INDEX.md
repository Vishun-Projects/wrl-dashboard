# Document index — WRL Portal handover

**Product:** WRL Portal (WRL Dashboard)  
**Production URL:** https://wrl-dashboard.vercel.app  
**Repository:** https://github.com/Vishun-Projects/wrl-dashboard  
**Pack version:** Production handover · 2026-09-02

> **Ready for company share.** Business, functional, technical, RBAC, and ops docs reflect production and codebase. VPS checklist needs SSH sign-off on host; formal acceptance block in `06-Delivery/DELIVERY_STATEMENT.md`.

## How to use this pack

| If you are… | Start here |
|-------------|------------|
| Business / VP / sign-off | [`CLOSURE_SUMMARY.md`](CLOSURE_SUMMARY.md) → [`01-Business/BRD_WRL_Portal.md`](../01-Business/BRD_WRL_Portal.md) |
| MIS ops / branch managers | [`02-Functional/ADMIN_USER_GUIDE.md`](../02-Functional/ADMIN_USER_GUIDE.md) |
| IT / developers | [`03-Technical/ARCHITECTURE.md`](../03-Technical/ARCHITECTURE.md) → [`API_REFERENCE.md`](../03-Technical/API_REFERENCE.md) |
| Roles / security | [`04-RBAC/ROLES_SNAPSHOT.md`](../04-RBAC/ROLES_SNAPSHOT.md) → [`RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx) |
| VPS / cron / mail ops | [`05-Operations/`](../05-Operations/) |

## Document register

| Document | Audience | Status |
|----------|----------|--------|
| [CLOSURE_SUMMARY.md](CLOSURE_SUMMARY.md) | All stakeholders | Ready |
| [BRD_WRL_Portal.md](../01-Business/BRD_WRL_Portal.md) | Business / VP | Ready |
| [SCOPE_SUMMARY.md](../01-Business/SCOPE_SUMMARY.md) | Business / PM | Ready |
| [FMS_Functional_Module_Spec.md](../02-Functional/FMS_Functional_Module_Spec.md) | Functional / MIS | Ready (repo-generated) |
| [ADMIN_USER_GUIDE.md](../02-Functional/ADMIN_USER_GUIDE.md) | End users | Ready (text guide) |
| [ARCHITECTURE.md](../03-Technical/ARCHITECTURE.md) | IT / developers | Ready (repo-generated) |
| [CODEBASE_STRUCTURE.md](../03-Technical/CODEBASE_STRUCTURE.md) | IT / developers | Ready (repo-generated) |
| [API_REFERENCE.md](../03-Technical/API_REFERENCE.md) | IT / integrators | Ready (auto-generated from routes) |
| [GIT_AND_RELEASE.md](../03-Technical/GIT_AND_RELEASE.md) | IT / release | Ready (auto-generated) |
| [diagrams/](../03-Technical/diagrams/) | IT / architects | Ready |
| [RBAC_MATRIX.xlsx](../04-RBAC/RBAC_MATRIX.xlsx) | Roles / IT | Ready (live DB export) |
| [ROLES_SNAPSHOT.md](../04-RBAC/ROLES_SNAPSHOT.md) | Roles / IT | Ready (live DB export) |
| [RBAC_DECISION_FLOW.md](../04-RBAC/RBAC_DECISION_FLOW.md) | IT / security | Ready |
| [PROD_READ_SOURCE.md](../05-Operations/PROD_READ_SOURCE.md) | Ops | Ready |
| [MAIL_SCHEDULE.md](../05-Operations/MAIL_SCHEDULE.md) | Ops | Ready |
| [SYNC_ENTRY_POINTS.md](../05-Operations/SYNC_ENTRY_POINTS.md) | Ops | Ready |
| [KNOWN_ISSUES_AND_LIMITATIONS.md](../05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md) | All | Ready |
| [VPS_ENV_VERIFICATION_CHECKLIST.md](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md) | Ops | **Needs SSH sign-off** |
| [SYSTEM_VERIFICATION.md](../06-Delivery/SYSTEM_VERIFICATION.md) | All | Ready (auto-generated) |
| [DELIVERY_STATEMENT.md](../06-Delivery/DELIVERY_STATEMENT.md) | VP / Rakesh | Ready — sign-off block blank |
| [06-Delivery/README.md](../06-Delivery/README.md) | All | Index |
| **Company share (PDF / Word)** | All stakeholders | [`07-Company-Share/`](../07-Company-Share/) |
| [RBAC_MATRIX.xlsx](../07-Company-Share/Excel/RBAC_MATRIX.xlsx) | Roles / IT | Ready (live DB export) |

## Regenerate

See [`README.md`](../README.md) — `npm run handover:export` (rebuilds PDF, Word, diagrams, zip).
