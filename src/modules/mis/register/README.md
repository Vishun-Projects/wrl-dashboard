# Feature layout

```text
components/  React UI
services/    domain logic
server/      API/CRM/Postgres (when present)
```

Import UI deeply (`@/features/<domain>/components/...`). Prefer the feature barrel for client-safe services and `@/features/<domain>/server` (or `server.ts`) for server code.
