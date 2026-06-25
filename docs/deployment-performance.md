# Deployment performance notes

## Database region vs Vercel

Production API routes on Vercel (e.g. `iad1`) pay round-trip latency to Postgres on every cold auth and read-model query.

**Recommendations:**

1. Host Postgres in the same region as the primary Vercel deployment when possible.
2. Use Supabase pooler port `6543` for serverless (`DATABASE_URL` with `pgbouncer=true`) — already configured in `src/lib/read-model/db.ts`.
3. Keep short TTL caches on hot paths (`/api/auth/me`, admin bootstrap, performance snapshot).
4. For read-heavy dashboards, consider a read replica in the Vercel region with read-only queries routed via env flag.

## Measuring after deploy

Use **Admin → Performance Insights** and compare:

- LCP and FCP on `/admin/performance-insights` and `/report`
- `X-Cache` and `Server-Timing` on `/api/auth/me`
- Slow resource list (snapshot API should not dominate after sync-meta caching)

## Sync worker

Run the sync worker close to Postgres (direct `5432`, `USE_DIRECT_DATABASE=true`), not on Vercel serverless.
