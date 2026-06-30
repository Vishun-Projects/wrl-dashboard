'use client';

import dynamic from 'next/dynamic';

const PerformanceInsightsPanel = dynamic(
  () =>
    import('@/components/admin/PerformanceInsightsPanel').then((mod) => mod.PerformanceInsightsPanel),
  {
    loading: () => (
      <div className="rounded-2xl border border-slate-200 bg-bg-canvas p-8 text-sm text-slate-500 animate-pulse">
        Loading performance metrics…
      </div>
    ),
  }
);

export function PerformanceInsightsPageClient() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <PerformanceInsightsPanel />
    </div>
  );
}
