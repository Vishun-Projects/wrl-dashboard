# Activity / Security Audit Logging

## What is logged
Mutations, exports, and operational actions (who / what / when / result).  
Page navigations and routine report GETs are **not** logged.

### Auth / session
- `auth.sign_in.success|failure`
- `auth.sign_out`
- `auth.token.invalid`
- `auth.access.denied`
- `auth.password_reset.request|complete`

### Admin
- `admin.user.create|update|delete|password_reset`
- `admin.role.create|update|delete`
- `admin.mis_email_org_settings.update`
- `admin.mis_email_routing.create|update|delete`
- `admin.major_repair_recipient.create|update|delete`
- `admin.mis_email.test`

### Profile / mail
- `profile.update`
- `profile.mis_email.update`
- `profile.mis_email.send`

### Imports / exports / sync
- `import.mis_client.upload.start` then `import.mis_client.upload` (finish) with `durationMs` / `processDurationMs` in metadata — chunked uploads start on first chunk, finish after import
- `import.mis_client.delete|download`
- `import.mis_client.source.create|update`
- `report.export.start|complete|cancelled|failure` (CSV streams log the terminal event when the download finishes, fails, or is aborted — not when headers are sent)
- `sync.manual.start|complete|failure`

### Register / profile extras
- `register.flag.set`
- `register.comment.create`
- `profile.avatar.upload`
- `admin.call_register.visible_clients.update`

## Data model
- `public.security_audit_events` — append-only activity log
- `public.auth_sessions` — session ledger keyed by `wrl_session_id`

Each event stores:
- **When:** `created_at`
- **Who:** `actor_user_id`, `actor_email`, `metadata.actorName`
- **What:** `event_type`, `metadata.actionLabel`, `metadata.summary`, `target_*`
- **Result:** `result`, `status_code`, `route`, `ip`, `metadata`

## Redaction
Never persist passwords, tokens, cookies, API keys, or authorization headers.  
Matching metadata keys are stored as `[REDACTED]`.

## Review UI
- Page: `/admin/security-audit` (sidebar: **Activity Log**)
- Requires `manage_users` + email allowlist
- Filters: action key, actor email, result, date range
- Click a row to expand metadata

## API
- `GET /api/admin/security-audit`
- Query params: `eventType`, `actorUserId`, `actorEmail`, `result`, `from`, `to`, `limit`

## Retention
- Recommended: 180 days
- Cleanup helper: `deleteExpiredSecurityAuditData(180)`

## Deploy
1. Ensure `docs/read-model-phase1-schema/25-security-audit.sql` is applied
2. Deploy app code
3. Perform one sign-in, one admin edit, one export, then open Activity Log
