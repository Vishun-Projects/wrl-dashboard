'use client';

import React, { useState } from 'react';
import Link from 'next/link';

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
        throw new Error(payload.error || 'Request failed');
      }
      setMessage(
        payload.message ||
          'If an account exists for that email, you will receive password reset instructions shortly.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6 font-sans">
      <div className="relative w-full max-w-[400px] rounded-[32px] border border-slate-100 bg-bg-canvas p-10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.08)]">
        <div className="mb-8 text-center">
          <h1 className="text-2xl text-[#0f172a] ui-strong">Reset password</h1>
          <p className="mt-2 text-[13px] text-slate-500">
            Enter your work email and we will send a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="ml-1 text-[11px] text-slate-400 ui-label">Email address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-13 w-full rounded-2xl border border-slate-100 bg-bg-soft/50 px-5 py-3 text-[14px] font-medium text-slate-900 outline-none transition-all focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
              placeholder="name@westernequipments.com"
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-[12px] text-rose-600">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-[12px] text-emerald-700">
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="h-14 w-full rounded-2xl bg-[#0f172a] text-[15px] text-white shadow-[0_20px_40px_-12px_rgba(15,23,42,0.3)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 ui-strong"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-8 text-center text-[12px] text-slate-500">
          <Link href="/login" className="font-medium text-slate-700 hover:text-slate-900">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
