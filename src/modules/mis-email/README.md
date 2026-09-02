# MIS Email module (mail & alerts)

## Why this exists

Ops need one place that decides **who** gets MIS digests and major-repair repeat alerts, and **when**. Without it, every report/admin surface would invent its own recipient lists, schedules, and outbound gates.

```text
Cron / CLI  →  run-digest (personal prefs ∪ routing rules in IST window)
                  ↓
            compose-digest + mail-basis (Cadbury-safe counts)
                  ↓
            @/modules/mis-email/services/send.ts (sendDigestPayload · sendHtmlEmail)
                  ↓
            @/lib/mail (SMTP / VPS relay when send.ts delegates)
                  ↓
            slot success log (no double-send)

Major-repair worker  →  resolveAlertRecipients (branch To → HQ Cc) → sendHtmlEmail

Cancelled-call digest  →  yesterday IST rows from @/modules/cancelled-calls → sendDigestPayload

Subcontractor stock  →  email-sender.ts → sendHtmlEmail (worker in @/modules/subcontractor-stock)
```

## What is *not* here

| Concern | Lives in |
|---------|----------|
| SMTP / VPS relay / domain allowlists | `@/lib/mail/*` |
| BD-MIS / Register math | `@/modules/mis`, `@/sql/*` |
| Cron pause catalog | `@/lib/vps-cron/*` (digest is a catalog id; worker is CLI) |
| Cancelled-call register query / Excel | `@/modules/cancelled-calls` |
| Subcontractor stock reconcile / VPS CLI | `@/modules/subcontractor-stock` |
| MIS email permission names | `@/lib/auth/rbac-catalog.ts` |
| Thin admin / profile stubs | `src/app/admin/mis-email-*`, `src/app/api/…` |

## Layout

```text
pages/        Hub, org settings, routing, major-repair UI
components/   Composer, send tracker, subnav, chips
services/     Compose, preferences, routing-rules, run-digest, mail-basis
server/
  routes/     Admin + profile preference APIs
  sync/       Major-repair repeat alert + recipients
index.ts      Tiny public barrel (`defaultPreferencesForRecipient`)
```

---

## Core flows

**Digest**

1. Cron/CLI hits `run-digest` for personal prefs and/or routing rules in the half-open IST window.
2. Resolve recipients / office scope / date range; compose via `compose-digest` + `mail-basis`.
3. Enforce HTML size budget; send through `@/lib/mail`.
4. Log routing success for slot dedupe + security audit.

**Major-repair**

1. Sync worker detects repeat major repair.
2. `resolveAlertRecipients` — branch enabled To wins; HQ To/Cc become Cc (or sole To if no branch rows).
3. Send alert; new recipient rows default `enabled=false`.

**Cancelled-call digest**

1. Cron/CLI runs `cancelled-call-digest` for yesterday (IST).
2. Fetches rows via `@/modules/cancelled-calls`; builds per-branch Excel.
3. Sends to branch recipients; slot dedupe via digest recipient tables.

**Subcontractor stock (hub tab only)**

Mail & Alerts hosts the settings UI; reconcile/inbox/send workers are in `@/modules/subcontractor-stock`.

---

## Invariants (easy to break)

1. Digest numbers are **Cadbury-safe**: CRM Cadbury excluded; Mondelez + Coke imports fill gaps (`mail-basis.ts`). Different from BD-MIS West CRM Cadbury rule — do not unify casually.
2. Personal + routing schedules use a **half-open IST window** `[anchor, anchor+window)` (default 15m). Closing the interval or passing personal `sendTimeIst` into routing double-fires or blasts HOD To/Cc.
3. Routing: **one successful send per rule per slot** (`hasSuccessfulRoutingSendInSlot`) — not per digest user.
4. HTML under Gmail clip (~102 KB); safe budget ~95 KB. No rowspan layouts.
5. Major-repair: **branch enabled To wins**; HQ demotes to Cc. Don’t invent a second recipient policy.
6. Org `outboundMailEnabled` + allowed domains gate all sends/writes.

---

## Where to look

| Need | Place |
|------|--------|
| Hub / settings / routing / major-repair UI | `pages/*` |
| Compose + Cadbury math | `services/compose-digest.ts`, `mail-basis.ts` |
| Prefs / half-open timing | `services/preferences.ts` |
| Routing + slot dedupe | `services/routing-rules.ts` |
| Digest runner | `services/run-digest.ts` |
| Major-repair To/Cc | `server/sync/major-repair-repeat-recipients.ts` |
| Alert worker | `server/sync/major-repair-repeat-alert.ts` |

## When you change something

| Change | Also check |
|--------|------------|
| Open-call / Cadbury counting | `mail-basis`, compose tests, open-count parity, BD-MIS (different West rule) |
| Schedule window / cron interval | `shouldSendMisEmailNow`, `shouldTriggerRoutingRuleNow`, slot log |
| MIS email permission rename | `rbac-catalog`, users enable-email gate, recipients |
| Recipient domain / kill-switch | `allowed-domains`, org-settings |
| Major-repair To/Cc | `resolveAlertRecipients` only |
| Cancelled digest | `services/cancelled-call-digest.ts`, `server/sync/cancelled-call-digest-recipients` |
| Subcontractor tab | `@/modules/subcontractor-stock/pages/*` |
