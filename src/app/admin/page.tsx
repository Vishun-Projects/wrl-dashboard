'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/users');
  }, [router]);

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-[#0f172a] rounded-full animate-spin" />
        <p className="text-[11px] tracking-[0.2em] text-slate-400 ui-label">Redirecting to Management...</p>
      </div>
    </div>
  );
}
