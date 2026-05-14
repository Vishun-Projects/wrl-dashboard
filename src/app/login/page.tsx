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
    <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-background relative transition-colors duration-300 font-sans">
      
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/20">
             <div className="w-8 h-8 border-4 border-white rounded-full" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight font-brand text-primary">FastClose</h1>
          <p className="text-sm text-muted-foreground font-medium">
            Western Refrigeration Portal
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">Email Address</label>
              <input
                id="email-address"
                name="email"
                type="email"
                required
                className="relative block w-full rounded-xl border-0 py-3 text-foreground bg-secondary ring-1 ring-inset ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-primary-brand sm:text-sm px-4 outline-none transition-all"
                placeholder="name@western-vass.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin(e as any)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase ml-1">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="relative block w-full rounded-xl border-0 py-3 text-foreground bg-secondary ring-1 ring-inset ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-primary-brand sm:text-sm px-4 outline-none transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin(e as any)}
              />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-xs text-center font-bold bg-red-50 p-2 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="group relative flex w-full justify-center rounded-xl bg-primary-brand px-3 py-4 text-sm font-bold text-white hover:bg-primary shadow-lg shadow-primary-brand/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-brand disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {loading ? 'Authenticating...' : 'Access Portal'}
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest opacity-50">
          Internal Management Review System
        </p>
      </div>
    </div>
  );
}
