/** Clear httpOnly session cookies, then hard-navigate to login (breaks middleware redirect loops). */
export async function signOutAndGoToLogin(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    /* best-effort */
  }
  window.location.assign('/login');
}
