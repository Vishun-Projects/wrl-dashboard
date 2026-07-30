import assert from 'node:assert/strict';
import { resolvePortalUrlForResetEmail } from '@/lib/auth/portal-url-from-reset-link';

const link =
  'https://api.wrl-fsm.cloud/auth/v1/verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fwrl-dashboard.vercel.app%2Freset-password';

assert.equal(
  resolvePortalUrlForResetEmail({ resetLink: link }),
  'https://wrl-dashboard.vercel.app'
);

assert.equal(
  resolvePortalUrlForResetEmail({
    resetLink: link,
    portalUrl: 'http://localhost:3000',
  }),
  'https://wrl-dashboard.vercel.app'
);

assert.equal(
  resolvePortalUrlForResetEmail({
    resetLink: 'https://api.wrl-fsm.cloud/auth/v1/verify?token=x',
    portalUrl: 'https://wrl-dashboard.vercel.app',
  }),
  'https://wrl-dashboard.vercel.app'
);

console.log('portal-url-from-reset-link.check.ts: ok');
