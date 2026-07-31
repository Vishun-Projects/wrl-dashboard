# MIS module

MIS Reports hub: summary, call register, accounts, BD-MIS, client import.

```text
pages/           ReportPageClient, CallRegisterPageClient
components/      Filters, tabs, loading feedback, …
hooks/           Report hooks
services/        Report domain services
register/        Call-register UI + server + services
client-import/   MIS client file import (services + server.ts)
server/routes/   /api/report/* (MIS-owned) + /api/mis-client-import/*
download.ts      Thin blob download entry
index.ts         Public client-safe barrel
```

Sibling report pages (ARCP, distribution, …) are separate modules; they consume MIS filters/loading via `@/modules/mis/...`.
