'use client';

import React, { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { defaultLandingPath } from '@/lib/auth/rbac-catalog';
import { SESSION_EXPIRED_REASON } from '@/lib/auth/session-policy';
import {
  AuthAlert,
  AuthSplitShell,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
} from '@/components/auth/AuthSplitShell';

function humanizeSignInError(raw: string): string {
  const text = raw.trim();
  if (/temporarily unavailable|could not reach|network/i.test(text)) {
    return 'Sign-in is temporarily unavailable. Try again later.';
  }
  if (/required/i.test(text)) {
    return 'Email and password are required';
  }
  return 'Invalid email or password';
}

function LoginForm() {
  const searchParams = useSearchParams();
  const sessionExpiredBanner = useMemo(
    () => searchParams.get('reason') === SESSION_EXPIRED_REASON,
    [searchParams]
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      const signInTimeout = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({ email, password }),
      });

      clearTimeout(signInTimeout);

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'Failed to sign in'
        );
      }

      let landing = '/login';
      try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
          const data = await meRes.json();
          landing = defaultLandingPath(data.permissions ?? []);
        }
      } catch {
        /* use login fallback */
      }

      window.location.assign(landing);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Sign-in timed out. Check your connection and try again.');
      } else {
        setError(
          humanizeSignInError(err instanceof Error ? err.message : 'Failed to sign in')
        );
      }
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="text-[1.5rem] font-semibold tracking-[-0.025em] text-slate-900">
          Welcome back
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Enter your credentials to open the reports portal
        </p>
      </div>

      {sessionExpiredBanner ? (
        <div className="mb-5">
          <AuthAlert variant="info">
            Your session lasted 3 days and expired. Sign in again to continue.
          </AuthAlert>
        </div>
      ) : null}

      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className={authLabelClassName()}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            disabled={loading}
            className={authInputClassName()}
            placeholder="name@westernequipments.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="login-password" className={authLabelClassName()}>
              Password
            </label>
            <button
              type="button"
              className="text-[12px] font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:opacity-50"
              onClick={() => setShowPassword((v) => !v)}
              disabled={loading}
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
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            disabled={loading}
            className={authInputClassName()}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? <AuthAlert variant="error">{error}</AuthAlert> : null}

        <div className="pt-1">
          <button type="submit" disabled={loading} className={authButtonClassName()}>
            <span
              className="pointer-events-none absolute inset-0 opacity-50"
              aria-hidden
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, transparent 45%)',
              }}
            />
            {loading ? (
              'Signing in…'
            ) : (
              <>
                Sign in
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

      <p className="mt-5 text-center text-[13px]">
        <Link
          href="/forgot-password"
          className="font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          Forgot password?
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <AuthSplitShell>
      <Suspense fallback={<p className="py-8 text-center text-[13px] text-slate-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </AuthSplitShell>
  );
}
