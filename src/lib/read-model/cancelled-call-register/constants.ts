/** Cancelled call register (/report/cancelled-calls) — synced from Postgres mirror/hot, not CRM report SQL. */
export const CANCELLED_CALL_REGISTER_ENTITY = 'rpt_cancelcallregister';

/** When true, calls_cancelled is filled by cancelled-register sync — not hot side effects. */
export function isDedicatedCancelledRegisterSyncEnabled(): boolean {
  return process.env.SYNC_CANCELLED_REGISTER_ENABLED !== 'false';
}
