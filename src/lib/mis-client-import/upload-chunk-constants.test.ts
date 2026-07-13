import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIS_VERCEL_CHUNK_THRESHOLD_BYTES,
  shouldUseChunkedMisUpload,
} from '@/lib/mis-client-import/upload-chunk-constants';

describe('shouldUseChunkedMisUpload', () => {
  const originalUrl = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    } else {
      process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL = originalUrl;
    }
    if (originalWindow === undefined) {
      // @ts-expect-error restore missing window in Node
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    vi.unstubAllGlobals();
  });

  it('never chunks when VPS upload URL is set (even on Vercel)', () => {
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    vi.stubGlobal('window', { location: { hostname: 'wrl-dashboard.vercel.app' } });
    expect(shouldUseChunkedMisUpload(120 * 1024 * 1024)).toBe(false);
  });

  it('never chunks for localhost tunnel URL', () => {
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'http://127.0.0.1:3099/api/mis-client-import/upload';
    vi.stubGlobal('window', { location: { hostname: 'wrl-dashboard.vercel.app' } });
    expect(shouldUseChunkedMisUpload(50 * 1024 * 1024)).toBe(false);
  });

  it('chunks large files on Vercel when no external URL', () => {
    delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    vi.stubGlobal('window', { location: { hostname: 'wrl-dashboard.vercel.app' } });
    expect(shouldUseChunkedMisUpload(MIS_VERCEL_CHUNK_THRESHOLD_BYTES + 1)).toBe(true);
    expect(shouldUseChunkedMisUpload(MIS_VERCEL_CHUNK_THRESHOLD_BYTES)).toBe(false);
  });

  it('never chunks on local hostname without external URL', () => {
    delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(shouldUseChunkedMisUpload(120 * 1024 * 1024)).toBe(false);
  });
});
