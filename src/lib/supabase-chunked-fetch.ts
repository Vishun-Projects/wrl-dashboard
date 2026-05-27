import axios, { type AxiosRequestConfig } from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ChunkedFetchAuth = {
  getAuthHeaders: () => Promise<Record<string, string>>;
  refreshAuth: () => Promise<void>;
  getWithAuthRetry: <T>(
    url: string,
    config?: Omit<AxiosRequestConfig, 'headers'>,
    options?: { chunkIndex?: number; refreshEveryN?: number }
  ) => Promise<T>;
};

/** Fresh Supabase tokens for long-running chunked API loops (exports, tally loads). */
export function createChunkedFetchAuth(supabase: SupabaseClient): ChunkedFetchAuth {
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Unauthorized');
    return { Authorization: `Bearer ${token}` };
  };

  const refreshAuth = async (): Promise<void> => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      throw new Error('Session expired — please sign in again and retry.');
    }
  };

  const getWithAuthRetry = async <T>(
    url: string,
    config: Omit<AxiosRequestConfig, 'headers'> = {},
    options?: { chunkIndex?: number; refreshEveryN?: number }
  ): Promise<T> => {
    const refreshEveryN = options?.refreshEveryN ?? 5;
    const chunkIndex = options?.chunkIndex;
    if (
      chunkIndex === 0 ||
      (chunkIndex != null && chunkIndex > 0 && chunkIndex % refreshEveryN === 0)
    ) {
      await refreshAuth();
    }

    const attempt = async () => {
      const headers = await getAuthHeaders();
      const res = await axios.get<T>(url, { ...config, headers });
      return res.data;
    };

    try {
      return await attempt();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        await refreshAuth();
        return attempt();
      }
      throw err;
    }
  };

  return { getAuthHeaders, refreshAuth, getWithAuthRetry };
}

export function isChunkedFetchAuthError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Session expired');
}
