# Report feature layout

```text
components/  React UI (pages, panels, filters context)
services/    domain logic (filters, corpus, summary, exports)
server/      API-only helpers (disk cache, portal audit)
hooks/       React hooks
lib/         tiny pure helpers only (limits, geo re-export, corpus-sync-time)
```

Placement rule: React → `components/` or `hooks/`. Domain logic → `services/`. Next/Prisma/CRM/cookies → `server/`. Pure no-I/O helpers → `lib/`.
