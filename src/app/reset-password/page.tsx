'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { feedback } from '@/lib/ui/feedback';

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!cancelled) {
        setReady(Boolean(session));
        if (!session) {
          setError('Reset link is invalid or has expired. Request a new one.');
        }
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
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      feedback.actionSuccess('Password updated. You can sign in now.');
      window.location.assign('/login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Password update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-soft p-6 font-sans">
      <div className="relative w-full max-w-[400px] rounded-[32px] border border-slate-100 bg-bg-canvas p-10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.08)]">
        <div className="mb-8 text-center">
          <h1 className="ui-page-title">Choose a new password</h1>
          <p className="mt-2 ui-help">Use at least 6 characters.</p>
        </div>

        {loading ? (
          <p className="text-center ui-help">Verifying reset link…</p>
        ) : ready ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="ml-1 ui-field-label">New password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-13 w-full rounded-2xl border border-slate-100 bg-bg-soft/50 px-5 py-3 text-[14px] font-medium text-slate-900 outline-none transition-all focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
              />
            </div>
            <div className="space-y-1.5">
              <label className="ml-1 ui-field-label">Confirm password</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-13 w-full rounded-2xl border border-slate-100 bg-bg-soft/50 px-5 py-3 text-[14px] font-medium text-slate-900 outline-none transition-all focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
              />
            </div>

            {error ? (
              <div className="ui-help rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="h-14 w-full rounded-2xl bg-slate-900 text-[15px] text-white shadow-[0_20px_40px_-12px_rgba(15,23,42,0.3)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 ui-strong"
            >
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <p className="ui-help text-rose-700">{error || 'Reset link is invalid or expired.'}</p>
            <Link
              href="/forgot-password"
              className="ui-help font-medium text-slate-700 hover:text-slate-900"
            >
              Request a new link
            </Link>
          </div>
        )}

        <p className="mt-8 text-center ui-help">
          <Link href="/login" className="font-medium text-slate-700 hover:text-slate-900">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
