'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import type { SerialAuditCallDetail } from '@/lib/serial-audit/complaint-audit';
import { getRepeatedComplaintKeys } from '@/lib/serial-audit/complaint-audit';
import { getCallTypeBadgeClass } from '@/lib/report/call-type-badge';
import {
  buildRegisterDeepLinkHref,
  type RegisterDeepLinkParams,
} from '@/lib/report/filters';

const STATUS_BADGE: Record<SerialAuditCallDetail['statusTone'], string> = {
  open: 'badge-open',
  assigned: 'badge-assigned',
  techSolved: 'badge-solved',
  closed: 'badge-closed',
  cancelled: 'badge-cancelled',
  transferred: 'badge-transferred',
};

type SerialAuditCallsDetailTableProps = {
  calls: SerialAuditCallDetail[];
  serial: string;
  scope?: 'window' | 'allTime';
  dateRangeLabel?: string;
  loading?: boolean;
  showAllTime?: boolean;
  onShowAllTimeChange?: (enabled: boolean) => void;
  allTimeLoading?: boolean;
  allTimeCount?: number;
  /** Date window from Serial Audit — passed through to Call Register deep link. */
  registerLinkContext?: Omit<RegisterDeepLinkParams, 'search'>;
  /** When filtering by ASP / technician, shown instead of generic range label. */
  scopeHint?: string;
};

export function SerialAuditCallsDetailTable({
  calls,
  serial,
  scope = 'window',
  dateRangeLabel,
  loading = false,
  showAllTime = false,
  onShowAllTimeChange,
  allTimeLoading = false,
  allTimeCount,
  registerLinkContext,
  scopeHint,
}: SerialAuditCallsDetailTableProps) {
  const repeatedComplaints = useMemo(
    () => getRepeatedComplaintKeys(calls, { excludeCancelled: true }),
    [calls]
  );

  const isRepeatedComplaint = (call: SerialAuditCallDetail) => {
    if (call.statusTone === 'cancelled') return false;
    const key = call.complaint.trim().toLowerCase().replace(/\s+/g, ' ');
    return repeatedComplaints.has(key);
  };

  const showAllTimeToggle = onShowAllTimeChange != null && !scopeHint;

  if (calls.length === 0 && !loading && !allTimeLoading) {
    return (
      <p className="py-4 text-center text-[11px] text-slate-500">No call records found for this serial.</p>
    );
  }

  const repeatComplaintCount = calls.filter((c) => isRepeatedComplaint(c)).length;
  const scopeLabel = scopeHint
    ? scopeHint
    : scope === 'allTime'
      ? `All dates for serial ${serial} (repair filters still apply)`
      : `Calls in selected range${dateRangeLabel ? ` (${dateRangeLabel})` : ''}`;

  return (
    <div className="serial-audit-detail-wrap">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {scopeLabel}{' '}
            <span className="normal-case text-slate-400">
              ({allTimeLoading && showAllTime ? '…' : calls.length} call{calls.length === 1 ? '' : 's'})
            </span>
          </p>
          {repeatComplaintCount > 0 ? (
            <p className="mt-0.5 text-[10px] font-medium text-amber-700">
              {repeatComplaintCount} row{repeatComplaintCount === 1 ? '' : 's'} with repeated complaint text
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showAllTimeToggle ? (
            <label className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={showAllTime}
                disabled={allTimeLoading}
                onChange={(e) => onShowAllTimeChange(e.target.checked)}
                className="rounded border-slate-300"
              />
              Show all dates (ignore report range)
              {allTimeCount != null && allTimeCount > calls.length && !showAllTime ? (
                <span className="text-slate-400">({allTimeCount} total)</span>
              ) : null}
            </label>
          ) : null}
          <Link
            href={buildRegisterDeepLinkHref({
              search: serial,
              ...registerLinkContext,
            })}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <ExternalLink className="h-3 w-3" />
            Open in register
          </Link>
        </div>
      </div>
      {allTimeLoading && showAllTime && calls.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-slate-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
          Loading all-time calls for {serial}…
        </div>
      ) : loading && calls.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-slate-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
          Loading calls for {serial}…
        </div>
      ) : (
        <div className="serial-audit-detail-scroll">
          <table className="serial-audit-detail-table">
            <thead>
              <tr>
                <th>#</th>
                <th>TRN</th>
                <th>Raised</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Branch</th>
                <th>Franchisee</th>
                <th>Pincode</th>
                <th>Product</th>
                <th>Complaint</th>
                <th>Repair done</th>
                <th>Status</th>
                <th>Technician</th>
                <th>Solved</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call, idx) => {
                const repeated = isRepeatedComplaint(call);
                return (
                  <tr
                    key={`${call.trn}-${call.callId}-${idx}`}
                    className={repeated ? 'serial-audit-detail-row--repeat' : undefined}
                  >
                    <td className="text-slate-400">{idx + 1}</td>
                    <td className="font-mono">
                      {call.trn ? (
                        <TrnLink
                          trn={call.trn}
                          callId={call.callId}
                          className="text-slate-800 underline decoration-slate-300 hover:text-slate-950"
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap">{call.callDate ?? '—'}</td>
                    <td>
                      {call.callType !== '—' ? (
                        <span className={getCallTypeBadgeClass(call.callType)}>{call.callType}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-[120px] truncate" title={call.customer}>
                      {call.customer}
                    </td>
                    <td className="max-w-[120px] truncate" title={call.branch}>
                      {call.branch}
                    </td>
                    <td className="max-w-[120px] truncate" title={call.franchisee}>
                      {call.franchisee}
                    </td>
                    <td className="font-mono">{call.pincode}</td>
                    <td className="max-w-[100px] truncate" title={call.product}>
                      {call.product}
                    </td>
                    <td className="max-w-[220px]" title={call.complaint}>
                      <div className="flex flex-wrap items-start gap-1">
                        {repeated ? (
                          <span className="rounded bg-amber-200 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-900">
                            Repeat
                          </span>
                        ) : null}
                        <span>{call.complaint}</span>
                      </div>
                    </td>
                    <td className="max-w-[180px]" title={call.repairDone}>
                      {call.repairDone}
                    </td>
                    <td>
                      <span className={STATUS_BADGE[call.statusTone]}>{call.statusLabel}</span>
                    </td>
                    <td className="max-w-[100px] truncate" title={call.technician}>
                      {call.technician}
                    </td>
                    <td className="whitespace-nowrap">{call.solvedDate ?? '—'}</td>
                    <td className="max-w-[160px] truncate text-slate-500" title={call.remarks}>
                      {call.remarks}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
