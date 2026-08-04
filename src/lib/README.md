# `src/lib` layout

Domain UI/logic lives under `src/modules/<domain>/` (see [`docs/CODEBASE_STRUCTURE.md`](../../docs/CODEBASE_STRUCTURE.md)). `src/features/` is empty — do not add code.

What remains here is **shared infrastructure**:

| Path | Purpose |
|------|---------|
| `read-model/` | Nightly/incremental Postgres sync |
| `db/` | Prisma + CRM `postQuery` proxy |
| `supabase/` | Auth clients, admin, session, chunked fetch |
| `auth/` | Session, permissions, page access |
| `security/` | Audit log, rate limits |
| `call/` | Call type/status/register helpers (`call/row/` normalize) |
| `geo/` | Geocoding, distance, Leaflet CDN |
| `api/` | Cookie auth, same-origin, zod schemas |
| `mail/` | SMTP + VPS relay |
| `vps-cron/` | Portal-controllable cron catalog/settings |
| `ui/` | Toast feedback policy, theme, table sort |
| `dates/` / `aging/` | Local dates + open-call aging buckets |
| `crm/` / `net/` / `observability/` / `serial/` / `summary/` | Shared helpers |
| `utils/` | CSV, async sleep, run pool, user-facing errors |

Feature imports: `@/modules/warranty-master/server`, `@/modules/mis/services/filters`, etc.  
Infra: `@/lib/db/proxy`, `@/lib/read-model/...`.  
SQL builders: `@/sql/trhcalls/...` (not under `src/lib`).

Cross-cutting extracts that are truly shared may move to `src/shared/` over time (auth/db/ui leaves only).
