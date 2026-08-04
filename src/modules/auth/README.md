# Auth module

## Why this exists

Portal login/logout/`/me`/password-reset need HTTP handlers. Session policy, cookies, and JWT verification are shared infrastructure in `@/lib/auth`; this module owns only the **route bodies**.

```text
src/app/login (+ forgot/reset pages)
        ↓
POST /api/auth/sign-in | sign-out
GET  /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/complete-password-reset
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| Session TTL / soft-timeout cookies | `@/lib/auth/session-policy*.ts`, `persist-session-cookies.ts` |
| JWT / cookie resolve | `@/lib/auth/server-user.ts`, `supabase-cookie.ts` |
| Recovery email chain | `@/lib/auth/send-recovery-email.ts` (+ forgot helpers) |
| Login UI | `src/app/login`, forgot/reset pages |
| URL stubs | `src/app/api/auth/*` |

## Layout

```text
server/routes/
  sign-in.ts
  sign-out.ts
  me.ts
  forgot-password.ts
  complete-password-reset.ts
```

No pages folder — UI is under `src/app`.

---

## Core flows

1. POST sign-in → session cookies + audit session start (GoTrue and/or cookie persist).
2. Client polls GET `/api/auth/me` for profile + `sessionExpiresAt` (brief cache).
3. Forgot → lookup → recovery email, or **same generic ok** (no enumeration).
4. Complete reset → update password → wipe cookies / global signOut → force re-login.
5. Sign-out → clear cookies **before** GoTrue signOut + finish session audit.

---

## Invariants (easy to break)

1. Forgot-password always returns the **same generic success** — including failures and missing accounts (no enumeration).
2. Complete-reset clears recovery session; recovery JWT must not remain a usable portal session.
3. `/me` enforces **portal soft-timeout** even if the JWT is still valid.
4. Bearer API tokens skip absolute portal TTL; cookie sessions do not (`server-user.ts`).
5. Dev auth bypass can use DB sign-in; password reset send is skipped under bypass.
6. Cookie-embedded user id may be accepted if JWT verify fails (SSR storage shape) — trusts cookie integrity; see `supabase-cookie.ts`.

---

## Where to look

| Need | Place |
|------|--------|
| Sign-in / out | `server/routes/sign-in.ts`, `sign-out.ts` |
| Session profile | `server/routes/me.ts` |
| Forgot / complete | `forgot-password.ts`, `complete-password-reset.ts` |
| Cookie / TTL policy | `@/lib/auth/session-policy*.ts`, `persist-session-cookies.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Cookie / session names | `persist-session-cookies`, middleware, soft-timeout |
| Forgot response shape | Enumeration tests — keep generic |
| `/me` payload | Client auth context + me-cache invalidation on user edits |
| Portal TTL length | `session-policy`, cookie maxAge, UX copy |
