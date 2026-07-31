# Serial History module (Serial Wise History)

```text
pages/        SerialAuditPageClient
components/   Analysis panel, calls table, legend
services/     Complaint audit, CSV export
server/       Batch fetch, SQL scope
  routes/     /api/report/serial-audit/*
```

`lib/repair` and `lib/trhcalls` moved to `@/sql/repair` and `@/sql/trhcalls`. Imports: `@/modules/serial-history`, `@/sql/serial-history/sql-scope`.
