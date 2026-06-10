# VPS hosting — Supabase migration

Migrate from Supabase cloud to self-hosted Supabase on `187.127.145.253` with domain **`api.wrl-fsm.cloud`**.

## Prerequisites

- DNS: `api.wrl-fsm.cloud` A record → `187.127.145.253` (done)
- From Supabase cloud dashboard → **Settings → API**:
  - **JWT Secret** (not in `.env.local` — copy manually)
- From `.env.local`:
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - Database password (in `DATABASE_URL`)

## Step 1 — Setup Supabase on VPS

**Option A — one command from Git Bash** (uses `.env.vps-setup` in repo root):

```bash
bash scripts/vps-hosting/deploy-to-vps.sh setup
```

**Option B — manual SSH** (paste into your VPS session):

```bash
scp scripts/vps-hosting/setup-supabase.sh root@187.127.145.253:/root/
ssh root@187.127.145.253

JWT_SECRET='your-legacy-jwt-secret' \
POSTGRES_PASSWORD='your-db-password' \
ANON_KEY='paste-anon-jwt-from-env-local' \
SERVICE_ROLE_KEY='paste-service-role-jwt-from-env-local' \
bash /root/setup-supabase.sh
```

Use the **JWT anon/service_role keys** (not `sb_publishable_*`) — the app expects JWT format in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Step 1b — Repair (if health shows "name resolution failed")

```bash
bash scripts/vps-hosting/deploy-to-vps.sh repair
```

## Step 2 — Restore cloud database

```bash
bash scripts/vps-hosting/deploy-to-vps.sh migrate
# or: CLOUD_DB_PASSWORD='...' bash scripts/vps-hosting/migrate-db-from-cloud.sh
```

## Step 3 — App env (already updated in `.env.local`)

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.wrl-fsm.cloud` |
| `DATABASE_URL` | `postgresql://postgres.ddmapuyghfeoyajxbcjh:PASSWORD@api.wrl-fsm.cloud:6543/postgres?pgbouncer=true` |

Copy the same values to **Vercel** project env and redeploy.

See **[VERCEL_ENV.md](./VERCEL_ENV.md)** if production shows `exceed_egress_quota` or pages stuck on Loading.

## Step 4 — Verify

**Git Bash:**
```bash
curl -s https://api.wrl-fsm.cloud/auth/v1/health -H "apikey: YOUR_ANON_KEY"
```

**PowerShell** (use `curl.exe`, not `curl` — PowerShell aliases `curl` to `Invoke-WebRequest`):
```powershell
curl.exe -s "https://api.wrl-fsm.cloud/auth/v1/health" -H "apikey: YOUR_ANON_KEY"
```

Expected response: JSON like `{"version":"...","name":"GoTrue",...}`

**Browser:** Opening `https://api.wrl-fsm.cloud/` directly shows *"No API key found in request"* — that is normal (Kong gateway). Always use `/auth/v1/health` with the `apikey` header, or use the app login page.

```bash
npm run dev   # login, reports, sync
```

Create `profiles` storage bucket in Supabase Studio if avatar uploads fail.

## View database (Supabase Studio)

Studio is served through **Kong on port 8000** (not 54323).

**Terminal 1 — SSH tunnel only** (use `-N` so you don't get a VPS shell):
```bash
ssh -N -L 8000:127.0.0.1:8000 root@187.127.145.253
```

**Terminal 2 — run migrate/restore**

**Browser:** http://localhost:8000 — login `supabase` / your DB password

## PG17 upgrade failed (`supabase-db is unhealthy`)?

**Cause:** `docker compose down -v` removes Docker volumes but **not** `./volumes/db/data` on disk. PG17 cannot start on leftover PG15 files.

**Fix:** run restore again (script now deletes `volumes/db/data` automatically):
```bash
bash scripts/vps-hosting/deploy-to-vps.sh restore
```

Or manually on VPS:
```bash
cd /opt/supabase/docker
export COMPOSE_FILE=docker-compose.yml:docker-compose.pg17.yml
docker compose down -v
rm -rf ./volumes/db/data
docker compose up -d
```
