/** Target row count for calls_latest_hot backfill progress (sync-meta / incremental). */
export const HOT_TARGET_ROWS = 139_509;

/** Initial ncode shards per day — lighter sync query than ARCP; default 8 (ARCP uses 16 on a simpler table). */
export const SYNC_CRM_NCODE_SHARD_INITIAL =
  Number(process.env.SYNC_CRM_NCODE_SHARD_INITIAL ?? 8) || 8;

/** Max ncode shard splits before failing a calls CRM fetch window. */
export const SYNC_CRM_NCODE_SHARD_MAX =
  Number(process.env.SYNC_CRM_NCODE_SHARD_MAX ?? 32) || 32;
