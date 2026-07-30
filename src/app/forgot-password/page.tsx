'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  AuthAlert,
  AuthSplitShell,
  authButtonClassName,
  authInputClassName,
  authLabelClassName,
} from '@/components/auth/AuthSplitShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text =
          (typeof payload.error === 'string' && payload.error) ||
          'Enter a valid email address';
        setError(text);
        return;
      }
      setMessage(
        (typeof payload.message === 'string' && payload.message) ||
          'If an account exists for that email, you will receive password reset instructions shortly.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitShell
      headline={
        <>
          Get back into your <span className="text-amber-600">reports.</span>
        </>
      }
      support="We will email a secure link to your work inbox so you can choose a new password and reopen MIS and call reports."
    >
      <div className="mb-6">
        <h2 className="text-[1.5rem] font-semibold tracking-[-0.025em] text-slate-900">
          Forgot password
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Enter your work email and we will send a one-time reset link
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="forgot-email" className={authLabelClassName()}>
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            required
            autoComplete="email"
            disabled={loading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClassName()}
            placeholder="name@westernequipments.com"
          />
        </div>

        {error ? <AuthAlert variant="error">{error}</AuthAlert> : null}
        {message ? <AuthAlert variant="success">{message}</AuthAlert> : null}

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
              'Sending…'
            ) : (
              <>
                Send reset link
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
          href="/login"
          className="font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          Back to sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}
