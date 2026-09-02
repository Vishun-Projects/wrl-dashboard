# Known issues and limitations — WRL Portal

> **Status:** Ready — external-facing honest summary (not a marketing doc). Internal engineering backlog: `docs/REMEDIATION_ROADMAP.md` in the repository.

**Audience:** Stakeholders and ops.  
**Last updated:** 2026-09-02

---

## Design decisions and known limitations

From architecture §0.1 — deliberate simplifications, not immediate bugs:

| Area | Decision / limitation | Upgrade path |
|------|----------------------|--------------|
| **RLS** | Supabase Row-Level Security not used; RBAC + office scope in application code | Enable RLS if hard multi-tenant isolation required |
| **Read-model staleness** | `calls_latest_hot` can lag CRM ~3 min; call detail drawer hits CRM live | Acceptable for reporting; not real-time ops |
| **UI test coverage** | Near-zero `.test.tsx`; server has targeted unit tests only | Playwright/Vitest browser tests when UI stabilises |
| **Pagination** | Some routes return all rows (register export); others paginate | Cursor pagination if row counts exceed ~50k |
| **Module boundaries** | Some shared logic remains in `src/lib/` | Lint rule when team grows |
| **Email transport** | All outbound mail via `sendDigestPayload()` / `sendHtmlEmail()` in mis-email | — |
| **Email retry** | Failed sends logged; next cron poll (~15 min) is retry | Dedicated retry queue if SLA tightens |
| **CRM** | MS SQL read-only; no portal write-back | — |
| **VPS Postgres** | Single-node; no HA replica | Managed Postgres if 99.9%+ uptime required |

---

## Handover pack notes

| Item | Status |
|------|--------|
| Admin User Guide | Text-only by design (no screenshots) |
| RBAC RoleMatrix in Excel | Live from DB on each export |
| VPS `.env` sign-off | Checklist requires SSH on production host |
| Postgres backup owner | Not documented in repo — ops gap |

---

## Residual items (internal engineering backlog)

1. **`src/shared/` empty** — platform helpers remain under `src/lib/`.
2. **No ReportPageClient component tests** — logic-only unit tests.
3. **ReportPageClient orchestration** — further shrink possible; does not block delivery.

These do not block production use of delivered reports and mail flows.

---

## Operational notes

- **Mail slot dedupe:** One successful send per routing rule per IST window; failed sends wait for next cron.
- **Cadbury math:** Email digest uses Cadbury-safe rules; BD-MIS West zone keeps CRM Cadbury — counts may differ across surfaces (see FMS).
- **Subcontractor stock:** Full reconcile/send runs on VPS; portal relays manual actions when not on VPS host.
- **Diagram legibility:** Dense sequence diagrams — open `07-Company-Share/Diagrams/*.png` at full resolution or use Architecture Diagrams PDF (landscape pages for wide diagrams).

---

## Reporting issues

1. Note URL, user role, date filter, and TRN/branch if applicable.
2. Check read-model sync status: `/admin/sync`.
3. For mail: `05-Operations/MAIL_SCHEDULE.md` and VPS `mail-scheduler.log`.
4. Engineering: https://github.com/Vishun-Projects/wrl-dashboard
