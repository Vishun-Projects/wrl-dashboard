'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      router.push('/calls');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-6 font-sans">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-100 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-slate-200 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[400px] bg-white rounded-[32px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.08)] border border-slate-100 p-10">
        <div className="flex flex-col items-center text-center">
          {/* Logo Section */}
          <div className="mb-8">
            <img
              src="/western-head-logo-2025.png"
              alt="Western Logo"
              className="w-40 h-auto object-contain"
            />
          </div>

          <div className="space-y-1 mb-10">
            <h1 className="text-2xl font-black text-[#0f172a] tracking-tight">
              WRL Dashboard
            </h1>
            <p className="text-[13px] font-medium text-slate-400">
              Western Refrigeration Pvt. Ltd.
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">
                Email Address
              </label>
              <input
                type="email"
                required
                className="w-full h-13 bg-slate-50/50 border border-slate-100 rounded-2xl px-5 py-3 text-[14px] font-medium text-slate-900 placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 transition-all"
                placeholder="name@westernequipments.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider ml-1">
                Password
              </label>
              <input
                type="password"
                required
                className="w-full h-13 bg-slate-50/50 border border-slate-100 rounded-2xl px-5 py-3 text-[14px] font-medium text-slate-900 placeholder:text-slate-300 outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-4 bg-rose-50 rounded-2xl border border-rose-100 animate-in fade-in slide-in-from-top-1">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              <p className="text-[12px] font-bold text-rose-600">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 bg-[#0f172a] text-white rounded-2xl text-[15px] font-black shadow-[0_20px_40px_-12px_rgba(15,23,42,0.3)] hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? 'Authenticating...' : 'Login'}
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-slate-50 text-center">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">
            Internal Access Only
          </p>
        </div>
      </div>
    </div>
  );
}
