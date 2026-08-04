# Security Audit module

## Why this exists

Super Admins need a security/activity audit browser. Event **writes** happen all over the app via `@/lib/security`; this module only owns the **read UI** and a **tight client beacon** for browser-only export lifecycle events.

```text
Any route  →  logSecurityEventBestEffort (@/lib/security/audit)
Super Admin UI  →  GET /api/admin/security-audit
Browser export  →  POST /api/security-audit/client-action  (allowlisted types only)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Event write / labels / redact | `@/lib/security/audit.ts`, `audit-labels.ts` |
| Who can view | `@/lib/security/audit-access.ts` (`super_admin` only) |
| Thin stubs | `src/app/admin/security-audit`, related APIs |

## Layout

```text
pages/        SecurityAuditPageClient
server/routes/  security-audit.ts, client-action.ts
```

---

## Core flows

1. Super Admin opens Activity Log → GET with filters.
2. Server lists events via `listSecurityAuditEvents`.
3. Separately: browser export posts start/complete/cancelled/failure to `client-action`.
4. Other routes write directly through `@/lib/security/audit` — not through this module.

---

## Invariants (easy to break)

1. List API: **`super_admin` only** — not `manage_users` alone.
2. Client POST allowlist only: `report.export.{start,complete,cancelled,failure}` + fixed result set. No arbitrary `eventType`.
3. Client beacon: same-origin + authenticated.
4. Primitives stay in `@/lib/security` so any route can log — don’t move write helpers into this module.
5. UI labels come from `actionLabelFor` — renames need `audit-labels` too.
6. Vitest skips audit DB writes (`auditWritesEnabled`) — route unit tests stay side-effect free.

---

## Where to look

| Need | Place |
|------|--------|
| UI | `pages/SecurityAuditPageClient.tsx` |
| List API | `server/routes/security-audit.ts` |
| Client export beacon | `server/routes/client-action.ts` |
| Writers / labels | `@/lib/security/audit.ts`, `audit-labels.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| New audit action type | Writers + `actionLabelFor` + UI filters |
| Expand client allowlist | Security review — keep minimal |
| Access rule | `audit-access` + rbac path `/admin/security-audit` |
