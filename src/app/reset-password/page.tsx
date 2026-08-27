'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { feedback } from '@/lib/ui/feedback';
import {
  AuthAlert,
  AuthSplitShell,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
} from '@/components/auth/AuthSplitShell';

function stripRecoveryParamsFromUrl(): void {
  try {
    window.history.replaceState(null, '', '/reset-password');
  } catch {
    /* ignore */
  }
}

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function initSession() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          if (exchangeError) {
            setError(exchangeError.message);
            setLoading(false);
            return;
          }
          setReady(true);
          setLoading(false);
        }
        return;
      }

      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const type = hashParams.get('type');

      if (accessToken && refreshToken && type === 'recovery') {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!cancelled) {
          if (sessionError) {
            setError(sessionError.message);
            setLoading(false);
            return;
          }
          setReady(true);
          setLoading(false);
        }
        return;
      }

      // No recovery handoff — do not treat an ordinary session as reset-ready.
      if (!cancelled) {
        setReady(false);
        setError('Reset link is invalid or has expired. Request a new one.');
        setLoading(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
        setLoading(false);
        setError(null);
      }
    });

    void initSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/complete-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'Password update failed'
        );
      }

      stripRecoveryParamsFromUrl();
      feedback.actionSuccess('Password updated. You can sign in now.');
      // Hard navigation clears recovery state; router.push can leave stale session UI.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional post-reset full reload
      window.location.assign('/login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Password update failed');
      setSaving(false);
    }
  };

  return (
    <AuthSplitShell
      headline={
        <>
          Choose a password you can <span className="text-amber-600">trust.</span>
        </>
      }
      support="Use at least 6 characters. After saving, sign in again to open your reports."
    >
      <div className="mb-6">
        <h2 className="text-[1.5rem] font-semibold tracking-[-0.025em] text-slate-900">
          Set new password
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Use at least 6 characters for your new password
        </p>
      </div>

      {loading ? (
        <p className="py-6 text-center text-[13px] text-slate-500">Verifying reset link…</p>
      ) : ready ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="reset-password" className={authLabelClassName()}>
                New password
              </label>
              <button
                type="button"
                className="text-[12px] font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-50"
                onClick={() => setShowPassword((v) => !v)}
                disabled={saving}
              >
                {showPassword ? (
                  <span className="inline-flex items-center gap-1">
                    <EyeOff size={12} aria-hidden /> Hide
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Eye size={12} aria-hidden /> Show
                  </span>
                )}
              </button>
            </div>
            <input
              id="reset-password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={saving}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClassName()}
              placeholder="Enter new password"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="reset-confirm" className={authLabelClassName()}>
              Confirm password
            </label>
            <input
              id="reset-confirm"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete="new-password"
              disabled={saving}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authInputClassName()}
              placeholder="Confirm new password"
            />
          </div>

          {error ? <AuthAlert variant="error">{error}</AuthAlert> : null}

          <div className="pt-1">
            <button type="submit" disabled={saving} className={authButtonClassName()}>
              <span
                className="pointer-events-none absolute inset-0 opacity-50"
                aria-hidden
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 45%)',
                }}
              />
              {saving ? (
                'Saving…'
              ) : (
                <>
                  Update password
                  <ArrowRight
                    size={15}
                    className="relative transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <AuthAlert variant="error">
            {error || 'Reset link is invalid or expired.'}
          </AuthAlert>
          <p className="text-center text-[13px]">
            <Link
              href="/forgot-password"
              className="font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              Request a new link
            </Link>
          </p>
        </div>
      )}

      <p className="mt-5 text-center text-[13px]">
        <Link
          href="/login"
          className="font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          Back to sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}
