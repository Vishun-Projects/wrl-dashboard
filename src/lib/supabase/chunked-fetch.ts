import axios, { type AxiosRequestConfig } from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ensureFreshAccessToken,
  getBearerAuthHeaders,
  refreshSessionOnce,
} from '@/lib/supabase/session';

export type ChunkedFetchAuth = {
  getAuthHeaders: () => Promise<Record<string, string>>;
  refreshAuth: () => Promise<void>;
  getWithAuthRetry: <T>(
    url: string,
    config?: Omit<AxiosRequestConfig, 'headers'>,
    options?: { chunkIndex?: number; refreshEveryN?: number }
  ) => Promise<T>;
};

/** Auth helpers for long chunked API loops — refresh is single-flight, not per chunk. */
export function createChunkedFetchAuth(supabase: SupabaseClient): ChunkedFetchAuth {
  const getAuthHeaders = () => getBearerAuthHeaders(supabase);

  const refreshAuth = async (): Promise<void> => {
    await refreshSessionOnce(supabase);
  };

  const getWithAuthRetry = async <T>(
    url: string,
    config: Omit<AxiosRequestConfig, 'headers'> = {},
    _options?: { chunkIndex?: number; refreshEveryN?: number }
  ): Promise<T> => {
    const attempt = async () => {
      const headers = await getAuthHeaders();
      const res = await axios.get<T>(url, { ...config, headers });
      return res.data;
    };

    try {
      return await attempt();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        await refreshSessionOnce(supabase);
        return attempt();
      }
      throw err;
    }
  };

  return { getAuthHeaders, refreshAuth, getWithAuthRetry };
}

export { ensureFreshAccessToken };

export function isChunkedFetchAuthError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Session expired');
}

export function isChunkedFetchNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return err instanceof TypeError && /failed to fetch|network error/i.test(String(err));
  }
  return !err.response && Boolean(err.code === 'ERR_NETWORK' || err.message.includes('Network Error'));
}

/** Aborted chunk/job polls — not user-facing failures. */
export function isChunkedFetchAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (axios.isCancel(err)) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (axios.isAxiosError(err) && err.code === 'ERR_CANCELED') return true;
  if (err instanceof Error && err.name === 'CanceledError') return true;
  return false;
}
