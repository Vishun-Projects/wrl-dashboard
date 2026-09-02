# Delivery statement — WRL Portal

> **Generated:** 2026-09-02T05:51:55Z · Production: https://wrl-dashboard.vercel.app

## Delivered scope

| Area | Delivered capability |
| --- | --- |
| **Reporting** | MIS (Summary, Register, Accounts, BD-MIS, Deployment, Client Import), Call Distribution, ARCP, Serial/Location/Warranty audits, Cancelled Calls, Athena reconciliation |
| **Mail & alerts** | MIS digests, major-repair alerts, cancelled-call digests, subcontractor stock reconciliation |
| **Administration** | Users, roles/RBAC, Mail & Alerts hub, read-model sync, service-call activity, performance insights, security audit log |
| **Platform** | Supabase auth, office-scoped data, Vercel app + VPS workers |
| **Documentation** | Handover pack (BRD, FMS, Architecture, API ref, live RBAC matrix, ops runbooks) |

## Production facts (export snapshot)

| Item | Value |
| --- | --- |
| Portal URL | https://wrl-dashboard.vercel.app |
| Active users | 16 |
| Configured roles | 6 |
| Roles in use | BM - Serial Audit (6), Branch Manager (1), HOD (5), View Summary (4) |
| API routes | 78 |
| Git revision | `4cd6dee` |

## Suggested email to request sign-off

**To:** Rakesh, VP
**Cc:** Sunil, delivery team
**Subject:** WRL Portal — handover documentation and acceptance request

Dear Rakesh,

Please find attached the **WRL Portal** handover pack for Western Refrigeration.

| Item | Detail |
| --- | --- |
| **Production** | https://wrl-dashboard.vercel.app |
| **Active users** | 16 across 4 roles |
| **Scope** | MIS reporting, audit registers, mail digests, subcontractor reconciliation, user/role admin |
| **Documentation** | `07-Company-Share/` (PDF + Word + RBAC Excel) |

**Attached / linked:**

1. Closure summary + BRD + Scope summary
2. Functional module spec + Admin user guide + Architecture diagrams (PDF)
3. Known issues and limitations + ops runbooks
4. RBAC matrix (Excel) — 6 roles, live from production DB

**Ops verification:** VPS environment checklist should be completed on the production host before final sign-off.

**We request confirmation** that the delivered scope is accepted, or a list of outstanding items with owners and dates.

Regards,
_[Delivery team]_

---

## Sign-off (complete when received)

| Field | Value |
| --- | --- |
| **From** | |
| **Date** | |
| **Accepted** | [ ] Yes  [ ] Yes with conditions  [ ] No |

**Conditions / follow-ups:**

| # | Item | Owner | Due |
| --- | --- | --- | --- |
| 1 | | | |

## Related

- [`SYSTEM_VERIFICATION.md`](SYSTEM_VERIFICATION.md)
- [`CLOSURE_SUMMARY.md`](../00-Index/CLOSURE_SUMMARY.md)
- [`BRD_WRL_Portal.md`](../01-Business/BRD_WRL_Portal.md)
