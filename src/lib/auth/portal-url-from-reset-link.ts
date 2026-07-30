import { resolveAppOrigin } from '@/lib/auth/site-url';

/** Prefer redirect_to on a GoTrue action_link so VPS mail relay doesn't fall back to localhost. */
export function resolvePortalUrlForResetEmail(params: {
  resetLink: string;
  portalUrl?: string | null;
}): string {
  const explicit = params.portalUrl?.trim().replace(/\/$/, '');
  if (explicit && !isLocalhostOrigin(explicit)) return explicit;

  const fromLink = originFromRedirectTo(params.resetLink);
  if (fromLink && !isLocalhostOrigin(fromLink)) return fromLink;

  if (explicit) return explicit;
  if (fromLink) return fromLink;
  return resolveAppOrigin();
}

function originFromRedirectTo(resetLink: string): string | null {
  try {
    const redirect = new URL(resetLink).searchParams.get('redirect_to');
    if (!redirect) return null;
    return new URL(redirect).origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return /localhost|127\.0\.0\.1/i.test(origin);
  }
}
