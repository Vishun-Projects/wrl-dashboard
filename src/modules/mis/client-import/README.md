# Feature layout

```text
services/   import/parse/upload domain logic
index.ts    client-safe barrel
server.ts   server-only barrel (pg / read-model) — keep as file so it does not clash with a server/ folder
```
