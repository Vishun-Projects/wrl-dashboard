# VPS hosting — Supabase migration

Migrate from Supabase cloud to self-hosted Supabase on `187.127.145.253` with domain **`api.wrl-fsm.cloud`**.

**Full step-by-step runbook (DOCX):** [`WRL-VPS-Hosting-Runbook.docx`](./WRL-VPS-Hosting-Runbook.docx)  
If Word blocks the file, open [`WRL-VPS-Hosting-Runbook.md`](./WRL-VPS-Hosting-Runbook.md) or right-click DOCX → Properties → Unblock (Windows).  
Regenerate: `python scripts/vps-hosting/generate-runbook-docx.py`

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

## CRM sync worker (always on, every 3 minutes)

Keeps Postgres read-model in sync with Western CRM while the app is not open.

**Layout (git-SHA releases):** `/opt/fast-close-app/current` → `releases/<sha>`; env/logs/node_modules live in `shared/`. Last 5 SHAs listed in `release-history`.

**One-time setup from Git Bash** (uses `.env.vps-setup`):

```bash
npm run sync-worker:setup:vps
```

Then on the VPS, edit `/opt/fast-close-app/shared/.env.sync-worker`:

- `DATABASE_URL` — direct Postgres (`127.0.0.1:5432` on VPS)
- `SYNC_WORKER_ENABLED=true`
- `SYNC_INTERVAL_MS=180000` (3 minutes, default)

**Ship / roll back from your PC:**

```bash
npm run sync-worker:deploy:vps     # commit first; uploads releases/<sha>, flips current
npm run mis-email:deploy:vps       # same release pipeline (mail + sync tree)
npm run sync-worker:rollback:vps   # undo last deploy (current → previous)
SHA=abc123def456 npm run sync-worker:rollback:vps   # jump to a kept release
npm run sync-worker:status:vps     # systemd + current/previous + logs
npm run sync-worker:logs:vps       # tail -f shared/logs
```

| Surface | How you ship |
|---------|----------------|
| Web UI | `git push` → Vercel Instant Rollback |
| Mail + sync on VPS | deploy above (VPS **is** prod for mail) |

Schema/DDL: backup first; code rollback does **not** undo migrations. Never edit files under `releases/` or `current` by hand.

On VPS: `systemctl restart fast-close-sync-worker`

See [`docs/sync.md`](../docs/sync.md) for tuning and catch-up after downtime.

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
