import { describe, expect, it } from 'vitest';
import { resolvePortalUrlForResetEmail } from '@/lib/auth/portal-url-from-reset-link';

describe('resolvePortalUrlForResetEmail', () => {
  const link =
    'https://api.wrl-fsm.cloud/auth/v1/verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fwrl-dashboard.vercel.app%2Freset-password';

  it('prefers redirect_to origin over localhost portalUrl', () => {
    expect(
      resolvePortalUrlForResetEmail({
        resetLink: link,
        portalUrl: 'http://localhost:3000',
      })
    ).toBe('https://wrl-dashboard.vercel.app');
  });

  it('uses non-localhost portalUrl when link has no redirect_to', () => {
    expect(
      resolvePortalUrlForResetEmail({
        resetLink: 'https://api.wrl-fsm.cloud/auth/v1/verify?token=x',
        portalUrl: 'https://wrl-dashboard.vercel.app',
      })
    ).toBe('https://wrl-dashboard.vercel.app');
  });

  it('reads origin from redirect_to alone', () => {
    expect(resolvePortalUrlForResetEmail({ resetLink: link })).toBe(
      'https://wrl-dashboard.vercel.app'
    );
  });
});
