# Feature layout

```text
components/  React UI
services/    domain logic
server/      API/CRM/Postgres loaders
```

Import UI deeply. Prefer `@/features/serial-audit` for client-safe exports and `@/features/serial-audit/server` for server code.
