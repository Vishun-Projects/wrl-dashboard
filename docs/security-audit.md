# Activity / Security Audit Logging

## What is logged
Mutations, exports, and operational actions (who / what / when / result).  
Page navigations and routine report GETs are **not** logged.

### Auth / session
- `auth.sign_in.success|failure` — public errors stay vague (`Invalid email or password`); audit metadata keeps the real reason
- `auth.sign_out`
- `auth.session.expired` — absolute 3-day portal TTL (`wrl_session_started_at`)
- `auth.token.invalid`
- `auth.access.denied`
- `auth.password_reset.request` — `actor_email` = requested address; `result` + `metadata.reason` (`sent` | `account_not_found` | `send_failed` | …). UI always shows a generic “if an account exists…” message (no enumeration)
- `auth.password_reset.complete` — profile password change **or** recovery link via `POST /api/auth/complete-password-reset`

Portal sessions last **3 days from sign-in** (absolute, not idle). Expired page navigations redirect to `/login?reason=session_expired`; in-app APIs return `401` with `code: SESSION_EXPIRED` and the client shows a blocking dialog.

### Admin
- `admin.user.create|update|delete|password_reset` — user update stores structured `metadata.changes` (roles, offices, statuses, mis_email_enabled)
- `admin.role.create|update|delete` — role update stores `metadata.changes.permissionIds` (+ added/removed)
- `admin.mis_email_org_settings.update` — field-level `metadata.changes`
- `admin.vps_cron.pause|resume` — Super Admin pause map for managed VPS jobs
- `admin.mis_email_routing.create|update|delete`
- `admin.major_repair_recipient.create|update|delete`
- `admin.mis_email.test`
- `admin.call_register.visible_clients.update` — `metadata.changes.added|removed`

### Profile / mail
- `profile.update`
- `profile.mis_email.update`
- `profile.mis_email.send`

### Notifications (system actors)
- `notification.mis_email.digest.sent|failed` — cron digest (`actor_email` `system:mis-email-digest`)
- `notification.major_repair.sent|failed` — post-sync alerts (`system:major-repair-alert`)

### Imports / exports / sync
- `import.mis_client.upload.start` then `import.mis_client.upload` (finish) with `durationMs` / `processDurationMs` in metadata — chunked uploads start on first chunk, finish after import
- `import.mis_client.delete|download`
- `import.mis_client.source.create|update`
- `report.export.start|complete|cancelled|failure` — server CSV/XLSX streams; browser Excel/CSV/PDF via `POST /api/security-audit/client-action` (allowlisted). Prefer metadata: `reportName`, `format`, `rowCount`, `filters`, `durationMs`
- `sync.manual.start|complete|failure`
- `sync.schedule.start|complete|failure` — CLI incremental/nightly (+ daemon complete/failure; skips coalesced runs)

### Security
- `security.rate_limit.triggered` — proxy 429 denials (`rateClass`, `limit`, `retryAfterSec`)
  - `/api/auth/forgot-password`: 5 / 15 min per IP
  - `/api/auth/sign-in`: 10 / 15 min per IP
  - other `/api/auth/*`: 20 / min per IP
  - heavy report/sync routes: 10 / min; default APIs: 120 / min

### Register / profile extras
- `register.flag.set`
- `register.comment.create`
- `profile.avatar.upload`

## Data model
- `public.security_audit_events` — append-only activity log
- `public.auth_sessions` — session ledger keyed by `wrl_session_id`

Each event stores:
- **When:** `created_at`
- **Who:** `actor_user_id`, `actor_email`, `metadata.actorName`
- **What:** `event_type`, `metadata.actionLabel`, `metadata.summary`, `target_*`
- **Result:** `result`, `status_code`, `route`, `ip`, `metadata` (may include `changes` old→new)

## Redaction
Never persist passwords, tokens, cookies, API keys, or authorization headers.  
Matching metadata keys are stored as `[REDACTED]`.

## Review UI
- Page: `/admin/security-audit` (sidebar: **Activity Log**)
- Requires `super_admin` permission (Super Admin role)
- Filters: action key, actor email, result, date range
- Click a row to expand metadata

## API
- `GET /api/admin/security-audit`
- Query params: `eventType`, `actorUserId`, `actorEmail`, `result`, `from`, `to`, `limit`
- `POST /api/security-audit/client-action` — authenticated beacon for client-side exports (`report.export.*` only)

## Retention
- Recommended: 180 days
- Cleanup helper: `deleteExpiredSecurityAuditData(180)`

## API hardening (P0)
- **Safe errors:** API catch handlers use `jsonSafeError` / `safeErrorMessage` (`src/lib/api/safe-error.ts`) so clients never get raw stack/DB internals.
- **CSRF:** Cookie-authenticated mutations call `assertSameOriginMutation` (`src/lib/api/same-origin.ts`). Bearer-token requests skip the check.
- **TLS (Postgres):** `resolvePgSsl` verifies for `sslmode=verify-ca|verify-full`. Cloud pooler still uses TLS without hostname verify unless `PG_SSL_REJECT_UNAUTHORIZED=true`.

## Deploy
1. Ensure `docs/read-model-phase1-schema/25-security-audit.sql` is applied
2. Deploy app code
3. Perform one sign-in, one admin edit, one export, then open Activity Log
