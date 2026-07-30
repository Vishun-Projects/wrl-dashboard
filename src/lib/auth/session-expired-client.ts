'use client';

import { SESSION_EXPIRED_CODE } from '@/lib/auth/session-policy';

type Listener = () => void;

let open = false;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener();
}

export function isSessionExpiredDialogOpen(): boolean {
  return open;
}

export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Show blocking session-expired dialog (idempotent). */
export function showSessionExpired(): void {
  if (open) return;
  open = true;
  notify();
}

export function isSessionExpiredResponse(status: number, body: unknown): boolean {
  if (status !== 401) return false;
  if (!body || typeof body !== 'object') return false;
  return (body as { code?: unknown }).code === SESSION_EXPIRED_CODE;
}

/** Clear cookies then hard-navigate to login (dialog CTA / after expiry). */
export async function confirmSessionExpiredSignIn(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
  } catch {
    /* best-effort */
  }
  window.location.assign('/login?reason=session_expired');
}
