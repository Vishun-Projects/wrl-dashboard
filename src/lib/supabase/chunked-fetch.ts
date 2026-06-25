import axios, { type AxiosRequestConfig } from 'axios';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookieAuthRequestConfig } from '@/lib/api/cookie-auth';

export type ChunkedFetchAuth = {
  getWithAuthRetry: <T>(
    url: string,
    config?: Omit<AxiosRequestConfig, 'headers'>,
    options?: { chunkIndex?: number; refreshEveryN?: number }
  ) => Promise<T>;
};

/** Cookie-auth helpers for long chunked API loops (no browser GoTrue refresh). */
export function createChunkedFetchAuth(_supabase: SupabaseClient): ChunkedFetchAuth {
  const getWithAuthRetry = async <T>(
    url: string,
    config: Omit<AxiosRequestConfig, 'headers'> = {},
    _options?: { chunkIndex?: number; refreshEveryN?: number }
  ): Promise<T> => {
    const res = await axios.get<T>(url, { ...config, ...cookieAuthRequestConfig });
    return res.data;
  };

  return { getWithAuthRetry };
}

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
