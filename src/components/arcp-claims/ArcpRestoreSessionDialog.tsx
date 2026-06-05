'use client';

import React from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ARCP_DATE_FILTER_OPTIONS } from '@/lib/arcp-claims/query';
import type { ArcpAppliedFiltersSnapshot } from '@/lib/arcp-claims/applied-filters';
import type { ArcpClaimsAggregateRow } from '@/lib/arcp-claims/query';

export type ArcpRestoreSessionPayload = {
  filters: ArcpAppliedFiltersSnapshot;
  status: string;
  resumable: boolean;
  progressLabel?: string;
  partialAggregates?: ArcpClaimsAggregateRow[];
};

type ArcpRestoreSessionDialogProps = {
  open: boolean;
  payload: ArcpRestoreSessionPayload | null;
  onContinue: () => void;
  onStartFresh: () => void;
};

function filterSummary(payload: ArcpRestoreSessionPayload): React.ReactNode {
  const { filters, status, resumable, progressLabel } = payload;
  const dateBasis =
    ARCP_DATE_FILTER_OPTIONS.find((o) => o.value === filters.arcpDateFilterColumn)?.label ??
    'Call Date';
  const branch =
    filters.selectedBranch.length === 0 ? 'All branches' : filters.selectedBranch.join(', ');
  const franchisee =
    filters.selectedFranchisee.length === 0
      ? 'All franchisees'
      : filters.selectedFranchisee.join(', ');
  const callType =
    filters.selectedCallTypes.length === 0 ? 'All call types' : filters.selectedCallTypes.join(', ');

  return (
    <div className="space-y-2 text-[13px] text-slate-600">
      <p>
        A previous ARCP session was found
        {resumable ? ' (load in progress)' : ` (${status})`}. Continue with those filters and
        {resumable ? ' resume loading' : ' cached results'}, or start fresh and choose new filters.
      </p>
      <ul className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-[12px] text-slate-700">
        <li>
          <span className="text-slate-500">Date basis:</span> {dateBasis}
        </li>
        <li>
          <span className="text-slate-500">Range:</span> {filters.startDateStr} → {filters.endDateStr}
        </li>
        <li>
          <span className="text-slate-500">Branch:</span> {branch}
        </li>
        <li>
          <span className="text-slate-500">Franchisee:</span> {franchisee}
        </li>
        <li>
          <span className="text-slate-500">Call type:</span> {callType}
        </li>
        {progressLabel ? (
          <li>
            <span className="text-slate-500">Progress:</span> {progressLabel}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function ArcpRestoreSessionDialog({
  open,
  payload,
  onContinue,
  onStartFresh,
}: ArcpRestoreSessionDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Restore previous ARCP session?"
      description={payload ? filterSummary(payload) : null}
      confirmLabel="Continue previous session"
      cancelLabel="Start fresh"
      variant="default"
      onConfirm={onContinue}
      onCancel={onStartFresh}
    />
  );
}
