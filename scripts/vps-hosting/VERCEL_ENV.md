# Vercel → VPS cutover checklist

If Vercel logs show `exceed_egress_quota` or `AuthApiError: Service for this project is restricted`, **production is still calling Supabase cloud**, not your VPS.

## Why pages stick on "Loading..."

1. `/report` loads → `DashboardLayout` calls `GET /api/auth/me`
2. That route validates your JWT via Supabase Auth, then loads `app_users` + permissions via **Postgres** (`DATABASE_URL`)
3. If `DATABASE_URL` is wrong/missing, or your user has no row in `app_users` → **401** → profile never loads
4. UI shows skeleton + "Loading..." until `authReady` is true (never happens)

Localhost works because `.env.local` already points at `api.wrl-fsm.cloud`.

## Required: Production environment variables

Vercel → Project **wrl-dashboard** → **Settings** → **Environment Variables**

Set for **Production** (and Preview if you use preview URLs):

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.wrl-fsm.cloud` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same JWT anon key as `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | same JWT service_role key as `.env.local` |
| `DATABASE_URL` | `postgresql://postgres.ddmapuyghfeoyajxbcjh:PASSWORD@api.wrl-fsm.cloud:6543/postgres?pgbouncer=true` |

SSL is auto-disabled for self-hosted hosts (`api.wrl-fsm.cloud`). Supabase cloud pooler hosts still use TLS. Override with `PG_SSL=true` or `PG_SSL=false` if needed.

Also copy from `.env.local`:

- `SYNC_WORKER_ENABLED=true`
- `SYNC_ARCP_ENABLED=true`
- `READ_CALLS_FROM=postgres`
- `READ_REGISTER_FROM=postgres`
- `READ_SUMMARY_FROM=postgres`
- `READ_DISTRIBUTION_FROM=postgres`
- `READ_DIMS_FROM=postgres`
- `READ_ARCP_FROM=postgres`
- `NEXT_PUBLIC_READ_*_FROM=postgres` (all matching keys)
- `PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS` (optional)

**Remove or overwrite** any old values pointing at:

- `https://ddmapuyghfeoyajxbcjh.supabase.co`
- `aws-1-ap-southeast-1.pooler.supabase.com`

**Note:** `READ_*_FROM` and `NEXT_PUBLIC_READ_*_FROM` only control whether reports read from CRM vs Postgres. They do **not** fix `/api/auth/me` 401 — you need the four variables above plus a successful DB restore (`app_users` populated).

## Critical: Redeploy after changing env

`NEXT_PUBLIC_*` variables are **baked in at build time**. Changing env alone is not enough.

1. Save all env vars
2. **Deployments** → latest deployment → **⋯** → **Redeploy** (Production)
3. Or push an empty commit to trigger a new build

## Verify after redeploy

```powershell
curl.exe -s "https://api.wrl-fsm.cloud/auth/v1/health" -H "apikey: YOUR_ANON_KEY"
```

In browser (logged in on Vercel): DevTools → Network → `GET /api/auth/me` should return **200** with your user JSON, not 401.

Vercel logs should **no longer** show `exceed_egress_quota`.

## Sync on Vercel

Sync **reads** Western CRM (`westerncrm.com`) and **writes** to whatever `DATABASE_URL` is on Vercel → your VPS after cutover. It does not use Supabase cloud.
