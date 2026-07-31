# Location Audit module

```text
pages/        LocationAuditPageClient
components/   Row detail, compare map
services/     Types, CSV export
server/       Analyze, queries, handler
  routes/     /api/report/location-audit[+cache]
```

Geo helpers stay in `@/lib/geo` (shared with MIS / sync). Imports: `@/modules/location-audit`.
