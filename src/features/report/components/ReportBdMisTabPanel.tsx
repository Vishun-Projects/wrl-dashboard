'use client';

import { ReportErrorBoundary } from '@/features/report/components/ReportErrorBoundary';
import { BdMisSummaryPanel } from '@/features/report/components/BdMisSummaryPanel';
import type { BdMisGrandRow, BdMisRegionalRow } from '@/features/report/services/bd-mis-summary';

type Props = {
  bdMisGrand: BdMisGrandRow | null;
  bdMisRegionalRows: BdMisRegionalRow[];
  bdMisTabLoading: boolean;
};

export function ReportBdMisTabPanel({
  bdMisGrand,
  bdMisRegionalRows,
  bdMisTabLoading,
}: Props) {
  return (
    <ReportErrorBoundary label="Cadbury+Coke+CRM Summary Dashboard">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-soft/10 inner-scrollbar">
        {bdMisTabLoading ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 bg-bg-canvas/50"
            aria-hidden
          />
        ) : null}
        <div className="flex flex-col gap-3 p-4 pb-8">
          <BdMisSummaryPanel
            rows={bdMisRegionalRows}
            grand={
              bdMisGrand ?? {
                region: 'ALL',
                total_calls: 0,
                total_solved: 0,
                cancelled_calls: 0,
                age_2: 0,
                age_3: 0,
                age_7: 0,
                age_15: 0,
                part_pending: 0,
                active_eng: 0,
                open_calls: 0,
              }
            }
            loading={bdMisTabLoading}
          />
        </div>
      </div>
    </ReportErrorBoundary>
  );
}
