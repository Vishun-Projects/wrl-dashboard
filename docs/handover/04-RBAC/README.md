# RBAC — WRL Portal handover

| Artifact | Status | Use |
|----------|--------|-----|
| [ROLES_SNAPSHOT.md](ROLES_SNAPSHOT.md) | **Live (DB)** | Current roles, user counts, permissions — regenerated on export |
| [RBAC_MATRIX.xlsx](../07-Company-Share/Excel/RBAC_MATRIX.xlsx) | **Live (DB)** | RoleMatrix sheet = production grants (`Y` = allowed) |
| [RBAC_DECISION_FLOW.md](RBAC_DECISION_FLOW.md) | Ready | How authz is enforced in code |
| `10-rbac-decision-flow.png` | Ready | Diagram in Architecture Diagrams PDF |

Regenerate from production: `npm run handover:export` (requires `DATABASE_URL` in `.env.local`).

Workshop with Sunil/Rakesh is optional — matrix is already live from DB.
