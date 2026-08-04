# Roles module

## Why this exists

Page/tab/capability access is driven by role → permission sets. This module is the editor + CRUD API for those sets so admins can gate report and admin surfaces without code deploys.

```text
/admin/roles  →  RolesPageClient
        ↓
GET /api/admin/roles  (roles + allPermissions + groups)
        ↓
PUT/POST/DELETE  →  replace app_role_permissions
        ↓
Next /me / canAccessPath reflects new grants (after cache)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Permission catalog, aliases, UI grouping | `@/lib/auth/rbac-catalog.ts` |
| Runtime page access | `@/lib/auth/require-page-access.ts`, `canAccessPath` |
| Assigning roles to users | `users` module + `@/lib/auth/user-roles` |
| Thin stubs | `src/app/admin/roles`, `src/app/api/admin/roles` |

## Layout

```text
pages/        RolesPageClient
server/routes/  roles.ts
```

---

## Core flows

1. Admin with `manage_roles` opens Roles UI.
2. GET loads roles + `allPermissions` + `permissionGroups` (~20s process cache).
3. Create/update/delete replaces **all** `app_role_permissions` for that role (delete-then-insert).
4. Mutations **must** `clearRolesCache()`; user `/me` may need me-cache clear after assignment.

---

## Invariants (easy to break)

1. All routes require **`manage_roles`**; mutations are same-origin.
2. PUT replaces the full permission set for a role — partial PATCH is not the model.
3. Permission **string names** in DB must stay aligned with `rbac-catalog`. Renaming a string without catalog + seed breaks every gate.
4. Primary role for a user is `role_ids[0]` in users — deleting an assigned role can orphan users at the DB layer.
5. Mail & Alerts hub uses an **OR-gate** across legacy page permissions — see `canAccessPage` in rbac-catalog.

---

## Where to look

| Need | Place |
|------|--------|
| Editor UI | `pages/RolesPageClient.tsx` |
| CRUD API | `server/routes/roles.ts` |
| Catalog / aliases | `@/lib/auth/rbac-catalog.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| New permission string | Seed `app_permissions`, `rbac-catalog` groups/aliases, page gates |
| Role delete | Users still referencing `role_id` / junction |
| Cache | Mutations clear `rolesCache`; users bootstrap / me-cache |
| Mail hub access | `canAccessPage` OR-gate for email settings/routing/alerts |
