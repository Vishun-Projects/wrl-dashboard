# `src/lib` layout

Feature modules live in folders; shared infrastructure is grouped by concern.

| Path | Purpose |
|------|---------|
| `arcp-claims/`, `location-audit/`, `register/`, `serial-audit/`, `warranty-master/` | Report feature logic (`/server` for CRM/API) |
| `report/` | Portal corpus, filters, search, sync, preferences |
| `sync/` | Sync-proxy routes for read-model |
| `read-model/` | Nightly/incremental Postgres sync |
| `db/` | Prisma + CRM `postQuery` proxy |
| `supabase/` | Auth clients, admin, session, chunked fetch |
| `auth/` | Session, permissions, page access |
| `trhcalls/` | Call/register SQL helpers |
| `distribution/` | Call distribution roster + idle assignees |
| `geo/` | Geocoding, distance, Leaflet CDN |
| `utils/` | CSV, async sleep, run pool, user-facing errors |
| `call-row/` | Shared call row normalization |

Import examples: `@/lib/warranty-master/server`, `@/lib/report/filters`, `@/lib/db/proxy`.
