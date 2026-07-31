# `src/lib` layout

Domain UI/logic has moved under `src/features/<domain>/` (see [`docs/REMEDIATION_ROADMAP.md`](../../docs/REMEDIATION_ROADMAP.md)).

What remains here is **shared infrastructure**:

| Path | Purpose |
|------|---------|
| `sync/` | Sync-proxy routes for read-model |
| `read-model/` | Nightly/incremental Postgres sync |
| `db/` | Prisma + CRM `postQuery` proxy |
| `supabase/` | Auth clients, admin, session, chunked fetch |
| `auth/` | Session, permissions, page access |
| `trhcalls/` | Call/register SQL helpers |
| `geo/` | Geocoding, distance, Leaflet CDN |
| `utils/` | CSV, async sleep, run pool, user-facing errors |
| `call-row/` | Shared call row normalization |

Feature imports: `@/features/warranty-master/server`, `@/features/report/services/filters`, etc.  
Infra: `@/lib/db/proxy`, `@/lib/read-model/...`.

Cross-cutting extracts that are truly shared may move to `src/shared/` over time (auth/db/ui leaves only).
