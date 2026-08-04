# Users module

## Why this exists

Admins need one lifecycle for portal people (Supabase Auth + `app_users`, roles, offices, MIS email eligibility). Users need self-service profile (name/theme/password/avatar) without touching admin CRUD.

```text
Admin Users UI  →  /api/admin/users[+password|bootstrap]
                     Auth user + app_users + role junction

Profile UI      →  /api/profile[+password|avatar]
                     self-only mutations
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Permission catalog / `canAssignMisEmail` | `@/lib/auth/rbac-catalog.ts` |
| Role junction helpers | `@/lib/auth/user-roles.ts` |
| Session / me load | `@/lib/auth/load-user-auth.ts`, `me-cache` |
| Default MIS prefs when enabling email | `@/modules/mis-email` |
| Profile page shell | `src/app/profile` (thin) |
| URL stubs | `src/app/api/admin/users*`, `src/app/api/profile*` |

## Layout

```text
pages/        UsersPageClient
server/routes/
  users.ts             Admin CRUD
  password.ts          Admin set password
  bootstrap.ts         First-load users+roles
  profile.ts           Self profile PATCH
  profile-password.ts  Self password
  profile-avatar.ts    Avatar upload (path probe guard)
```

No `index.ts` barrel — deep-import by path.

---

## Core flows

1. Admin opens Users → bootstrap/list.
2. Create/update: Auth user + `app_users` + `replaceUserRoles`; optional MIS prefs seed.
3. Orphan recovery: Auth exists without `app_users` → attach profile instead of hard 409.
4. Admin password via service role; self password via profile-password.
5. Self: PATCH profile / avatar / password under `/api/profile*`.

---

## Invariants (easy to break)

1. Mutations require **same-origin** + `manage_users` (admin) or self (profile).
2. Enabling `mis_email_enabled` requires the **target** role set to pass `canAssignMisEmail` — not the admin’s permissions. Empty prefs get org defaults once.
3. **`office_ids: []` means all offices** (same as HOD); never treat as “none”.
4. Cannot delete your own account. Dev auth bypass may delete profile but leave Auth (503 path — no Admin API TLS).
5. After role/user edits: clear `me` + admin bootstrap caches.
6. Avatar: published-path probe guard — don’t allow path traversal into other users’ objects.

---

## Where to look

| Need | Place |
|------|--------|
| Admin UI | `pages/UsersPageClient.tsx` |
| CRUD + orphan recovery | `server/routes/users.ts` |
| Admin password | `server/routes/password.ts` |
| Bootstrap | `server/routes/bootstrap.ts` |
| Self profile / avatar | `server/routes/profile*.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Role / permission model | `user-roles`, `rbac-catalog`, roles UI |
| MIS email enable rules | `canAssignMisEmail`, mis-email defaults |
| Office empty-list meaning | Every `seesAllOffices` / assigned-office caller |
| Create/delete Auth | Dev-bypass paths, audit events, me-cache clear |
