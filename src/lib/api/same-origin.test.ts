import { afterEach, describe, expect, it } from 'vitest';
import { assertSameOriginMutation } from './same-origin';

describe('assertSameOriginMutation', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.VERCEL_URL;
  });

  it('allows matching Origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example';
    const req = new Request('https://app.example/api/x', {
      method: 'POST',
      headers: { Origin: 'https://app.example' },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it('rejects foreign Origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example';
    const req = new Request('https://app.example/api/x', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    const res = assertSameOriginMutation(req);
    expect(res?.status).toBe(403);
  });

  it('allows matching Referer when Origin is absent', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example';
    const req = new Request('https://app.example/api/x', {
      method: 'POST',
      headers: { Referer: 'https://app.example/profile' },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it('skips check for Bearer requests', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example';
    const req = new Request('https://app.example/api/x', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        Origin: 'https://evil.example',
      },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });

  it('rejects when Origin and Referer are both missing', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example';
    const req = new Request('https://app.example/api/x', { method: 'POST' });
    expect(assertSameOriginMutation(req)?.status).toBe(403);
  });

  it('allows Origin matching the request host even when SITE_URL differs', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://canonical.example';
    const req = new Request('https://preview.example/api/x', {
      method: 'POST',
      headers: { Origin: 'https://preview.example' },
    });
    expect(assertSameOriginMutation(req)).toBeNull();
  });
});
