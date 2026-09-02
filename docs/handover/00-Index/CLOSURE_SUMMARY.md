# Closure summary — WRL Portal

**One-page handover for email-out**

---

## Product

| Item | Value |
|------|-------|
| **Name** | WRL Portal (login screen: WRL Dashboard) |
| **Purpose** | Reporting, audits, mail digests, and admin on CRM service-call data |
| **Production** | https://wrl-dashboard.vercel.app |
| **Source** | https://github.com/Vishun-Projects/wrl-dashboard (`main`) |

## What was delivered

- **Reports:** MIS (register, summary, accounts, BD-MIS, deployment), distribution, ARCP, serial/location/warranty audits, cancelled calls, Athena reconciliation
- **Mail & alerts:** MIS digests, major-repair alerts, cancelled-call digests, subcontractor stock reconciliation
- **Administration:** Users, roles/RBAC, read-model sync status, service-call activity, performance insights
- **Documentation:** Business (BRD, scope), functional (FMS, admin guide), technical (architecture, API), live RBAC matrix, ops runbooks

## Where to start

Open [`DOCUMENT_INDEX.md`](DOCUMENT_INDEX.md) for the full table of contents and audience guide.

**For company email / SharePoint:** use `07-Company-Share/` — PDF and Word files, diagram PNGs, RBAC Excel, and `WRL_Portal_Handover_CompanyShare.zip`. See `07-Company-Share/DELIVERY_GUIDE.md`.

## Open items (human sign-off)

| Item | Owner | Status |
|------|-------|--------|
| VPS `.env` verification on production host | Ops / IT | See `05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md` |
| Formal acceptance | Rakesh / VP | Sign-off block in `06-Delivery/DELIVERY_STATEMENT.md` |
| Postgres backup procedure | Ops | Not documented in repo — ops to define |

## Known limitations (summary)

See [`05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md`](../05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md) for the full list. Highlights:

- Read-model ~3 min behind CRM; call drawer is live
- Single-node VPS Postgres (no HA)
- Admin user guide is text-only (no screenshots)

## Related

- [`DELIVERY_STATEMENT.md`](../06-Delivery/DELIVERY_STATEMENT.md) — deliverables + sign-off request
- [`SYSTEM_VERIFICATION.md`](../06-Delivery/SYSTEM_VERIFICATION.md) — live portal facts
