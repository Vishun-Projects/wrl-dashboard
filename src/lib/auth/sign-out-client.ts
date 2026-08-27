/** Clear httpOnly session cookies, then hard-navigate to login (breaks middleware redirect loops). */
export async function signOutAndGoToLogin(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    /* best-effort */
  }
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hard-navigate breaks middleware loops
  window.location.assign('/login');
}
