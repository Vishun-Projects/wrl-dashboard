import axios from 'axios';
import type { ReadModelProgress } from '@/lib/read-model/sync-meta';

/** Status can wait on an in-flight sync lock — default 90s beats short axios defaults. */
const STATUS_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_READ_MODEL_STATUS_TIMEOUT_MS ?? 90_000);

export async function fetchReadModelStatus(
  accessToken: string | undefined
): Promise<ReadModelProgress> {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await axios.get<ReadModelProgress>('/api/read-model/status', {
    headers,
    timeout: STATUS_TIMEOUT_MS,
  });
  return res.data;
}
