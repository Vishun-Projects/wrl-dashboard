# Sync module

Read-model status and VPS cron API handlers (ops).

```text
server/routes/  read-model-status, vps-cron
```

Manual incremental sync is CLI/worker (`src/lib/read-model`), not an HTTP route.
