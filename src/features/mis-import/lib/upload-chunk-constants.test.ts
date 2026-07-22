import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIS_UPLOAD_CHUNK_THRESHOLD_BYTES,
  resolveMisUploadChunkBytes,
  resolveMisUploadChunkUrl,
  shouldUseChunkedMisUpload,
  MIS_UPLOAD_CHUNK_BYTES,
  MIS_UPLOAD_CHUNK_BYTES_VPS,
} from '@/features/mis-import/lib/upload-chunk-constants';

describe('shouldUseChunkedMisUpload', () => {
  const originalUrl = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    } else {
      process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL = originalUrl;
    }
    vi.unstubAllGlobals();
  });

  it('chunks above threshold even when VPS upload URL is set', () => {
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    expect(shouldUseChunkedMisUpload(MIS_UPLOAD_CHUNK_THRESHOLD_BYTES + 1)).toBe(true);
    expect(shouldUseChunkedMisUpload(MIS_UPLOAD_CHUNK_THRESHOLD_BYTES)).toBe(false);
  });

  it('chunks large files on localhost', () => {
    delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    expect(shouldUseChunkedMisUpload(120 * 1024 * 1024)).toBe(true);
  });

  it('uses 8 MB chunks with VPS URL and 3 MB without', () => {
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    expect(resolveMisUploadChunkBytes()).toBe(MIS_UPLOAD_CHUNK_BYTES_VPS);
    delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    expect(resolveMisUploadChunkBytes()).toBe(MIS_UPLOAD_CHUNK_BYTES);
  });

  it('maps upload URL to upload-chunk', () => {
    process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL =
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload';
    expect(resolveMisUploadChunkUrl()).toBe(
      'https://api.wrl-fsm.cloud/api/mis-client-import/upload-chunk'
    );
    delete process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL;
    expect(resolveMisUploadChunkUrl()).toBe('/api/mis-client-import/upload-chunk');
  });
});
