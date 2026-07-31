# Mail & Alerts module

Combines MIS email digests and major-repair alerts.

```text
pages/        Hub, org settings, routing, major-repair UI
components/   Composer, send tracker, subnav, chips, …
services/     Compose/send/preferences/org settings
server/
  routes/     Admin + profile API handlers
  sync/       Major-repair repeat alert worker hooks
```

SMTP stays in `@/lib/mail`. Imports: `@/modules/mail-alerts`.
