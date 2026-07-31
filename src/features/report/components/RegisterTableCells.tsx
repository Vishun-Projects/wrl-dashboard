'use client';

import React from 'react';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { getCallTypeBadgeClass } from '@/features/report/services/call-type-badge';
import { resolveTechnicianDisplayName } from '@/features/report/services/filters';
import { classifyRegisterRowStatus } from '@/features/report/services/search';
import {
  type RegisterTableColumnKey,
} from '@/features/register';
import { formatUiDate } from '@/lib/dates/ui-date';
import { repairSemantics } from '@/lib/ui/semantics';

export function getRegisterCellClassName(key: RegisterTableColumnKey): string {
  if (key === 'UniqueCallNo')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-mono text-slate-400';
  if (key === 'vcclid')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-900';
  if (key === 'PartyName')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] font-medium text-slate-800';
  if (key === 'Pincode' || key === 'callsvserialno' || key === 'WCO')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700';
  if (
    key === 'officename' ||
    key === 'region' ||
    key === 'account' ||
    key === 'franchisee_name' ||
    key === 'itemname'
  )
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-700';
  if (key === 'serviceman' || key === 'vinsttel1')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-900';
  if (key === 'vpersoncalling')
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-600';
  if (key === 'bm_approved_date') {
    return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-600';
  }
  if (key === 'vsolveremarks') return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px]';
  if (key === 'vinstaddress') return 'whitespace-nowrap px-3 py-2 text-[11px] text-slate-500';
  return 'whitespace-nowrap border-r border-slate-50 px-3 py-2 text-[11px] text-slate-500';
}

type RenderOpts = {
  onSelectCall: (callId: string, row?: Record<string, unknown>) => void;
  priorityFilter: string[];
  technicianRoster: Array<{ value: string; label: string }>;
};

export function renderRegisterCell(
  key: RegisterTableColumnKey,
  row: Record<string, unknown>,
  opts: RenderOpts
): React.ReactNode {
  const formatDate = (dateStr: unknown) => formatUiDate(String(dateStr ?? '')) || '—';

  switch (key) {
    case 'UniqueCallNo':
      return (
        <button
          onClick={() => opts.onSelectCall(String(row.id), row)}
          className="text-slate-700 underline hover:text-slate-900"
        >
          {String(row.UniqueCallNo ?? '')}
        </button>
      );
    case 'vcclid':
      return (
        <button
          onClick={() => opts.onSelectCall(String(row.id), row)}
          className="underline hover:text-slate-700"
        >
          {row.vcclid != null ? String(row.vcclid) : '—'}
        </button>
      );
    case 'calltype':
      return (
        <span
          className={`ui-strong ${getCallTypeBadgeClass(
            row.calltype != null ? String(row.calltype) : undefined
          )}`}
        >
          {row.calltype ? String(row.calltype) : 'N/A'}
        </span>
      );
    case 'callsdtrndate':
      return formatDate(row.callsdtrndate);
    case 'PartyName':
      return (
        <span className="inline-flex items-center gap-1.5">
          {String(row.PartyName ?? '')}
          {opts.priorityFilter.length === 0 && row.is_major_repair === 'True' && (
            <span className="report-major-badge rounded bg-rose-500 px-1 py-0.5 ui-micro text-white ui-strong">
              MAJOR
            </span>
          )}
        </span>
      );
    case 'officename':
      return row.officename && row.officename !== 'UNKNOWN' ? String(row.officename) : '—';
    case 'region':
      return row.region != null ? String(row.region) : '—';
    case 'account':
      return row.account != null ? String(row.account) : '—';
    case 'franchisee_name':
      return row.franchisee_name && row.franchisee_name !== 'Unallocated'
        ? String(row.franchisee_name)
        : '—';
    case 'Pincode':
      return row.Pincode != null
        ? String(row.Pincode)
        : row.pincode != null
          ? String(row.pincode)
          : '—';
    case 'itemname':
      return row.itemname != null ? String(row.itemname) : '';
    case 'callsvserialno': {
      const serial = row.callsvserialno != null ? String(row.callsvserialno) : '';
      return serial ? <TruncatedText text={serial} className="font-mono" /> : '—';
    }
    case 'WCO': {
      const wco = row.WCO != null ? String(row.WCO).trim().toUpperCase() : '';
      return wco === 'W' || wco === 'C' || wco === 'O' || wco === 'V' ? wco : '—';
    }
    case 'serviceman':
      return resolveTechnicianDisplayName(row, opts.technicianRoster);
    case 'vcomplaint':
      return row.vcomplaint != null ? String(row.vcomplaint) : '';
    case 'repair_done': {
      const raw = String(row.repair_done ?? '');
      const chips = [
        raw.includes('Motor Replaced')
          ? { label: 'Motor', className: repairSemantics.motor }
          : null,
        raw.includes('Compressor Replaced')
          ? { label: 'Compressor', className: repairSemantics.compressor }
          : null,
        raw.includes('Gas Charging Done')
          ? { label: 'Gas', className: repairSemantics.gas }
          : null,
      ].flatMap((c) => (c ? [c] : []));
      if (!chips.length) return '—';
      return (
        <span className="inline-flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c.label} className={`rounded border px-1.5 py-0.5 ui-chip ${c.className}`}>
              {c.label}
            </span>
          ))}
        </span>
      );
    }
    case 'Status': {
      const bucket = classifyRegisterRowStatus(row);
      const isRejected =
        bucket === 'closed' &&
        (row.bmreject === 'Yes' ||
          String(row.rejectionstatus) === '1' ||
          String(row.rejectionstatus) === '2');
      if (isRejected) return <span className="badge-cancelled">Closed - Rejected</span>;
      if (bucket === 'cancelled') return <span className="badge-cancelled">Cancelled</span>;
      if (bucket === 'closed') return <span className="badge-solved">Solved</span>;
      if (bucket === 'techSolved') return <span className="badge-solved">Tech. Solved</span>;
      if (bucket === 'assigned') return <span className="badge-assigned">Assigned</span>;
      return <span className="badge-open">Open</span>;
    }
    case 'portal_action': {
      const flag = String(row.audit_flag || 'unseen');
      const label =
        flag === 'noted'
          ? 'Verified'
          : flag === 'query'
            ? 'Hold'
            : flag === 'escalate'
              ? 'Rejected'
              : 'Unseen';
      const badgeClass =
        flag === 'noted'
          ? 'badge-solved'
          : flag === 'query'
            ? 'badge-assigned'
            : flag === 'escalate'
              ? 'badge-cancelled'
              : 'badge-unseen';
      const comments = row.comments;
      const commentCount =
        row.comment_count ??
        (Array.isArray(comments) ? comments.length : 0);
      return (
        <div className="flex flex-col items-start gap-1">
          <span className={`ui-chip px-2 py-0.5 rounded ${badgeClass}`}>{label}</span>
          {Number(commentCount) > 0 && (
            <span className="ui-micro">
              {String(commentCount)} comment{Number(commentCount) !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      );
    }
    case 'callsolveddate':
      return formatDate(row.callsolveddate);
    case 'bm_approved_date':
      return row.bm_approved_date ? String(row.bm_approved_date).replace(/\./g, '/') : '—';
    case 'vsolveremarks': {
      const rejectionRemark = row.vcomment || null;
      const solveRemark = row.vsolveremarks || row.cancel_reason || null;
      if (rejectionRemark) {
        return <span className="font-medium text-rose-600">⚑ {String(rejectionRemark)}</span>;
      }
      return <span className="ui-help">{solveRemark ? String(solveRemark) : '—'}</span>;
    }
    case 'vpersoncalling':
      return row.vpersoncalling != null ? String(row.vpersoncalling) : '';
    case 'vinsttel1':
      return row.vinsttel1 != null ? String(row.vinsttel1) : '';
    case 'vinstaddress':
      return row.vinstaddress != null ? String(row.vinstaddress) : '';
    default:
      return '—';
  }
}
