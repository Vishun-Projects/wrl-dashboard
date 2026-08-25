/** Full CRM calls mirror entity — separate from calls_latest_hot. */
export const CALLS_MIRROR_ENTITY = 'calls_crm_mirror';

/** Advisory lock name — must not collide with hot `read_model_sync`. */
export const CALLS_MIRROR_LOCK_KEY = 'read_model_calls_crm_mirror';

export function callsMirrorSyncEnabled(): boolean {
  return process.env.CALLS_MIRROR_SYNC_ENABLED !== 'false';
}
