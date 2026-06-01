export const ARCP_NCODE_SHARD_MAX = Number(process.env.ARCP_OOM_SHARD_COUNT ?? 32) || 32;

/** Initial parallel ncode shards for ARCP CRM fetch (unified default). */
export const ARCP_NCODE_SHARD_INITIAL = Number(process.env.ARCP_OOM_SHARD_INITIAL ?? 16) || 16;
