# ARCP feature layout

```text
components/  React UI
services/    domain logic (query, table, export, pdf)
server/      API/CRM/Postgres loaders only
```

Import UI deeply (`@/features/arcp/components/...`). Prefer `@/features/arcp` for client-safe services and `@/features/arcp/server` for server code.
