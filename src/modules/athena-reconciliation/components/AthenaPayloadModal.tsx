'use client';

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  FileQuestion,
  ExternalLink,
  ShieldCheck,
  FileText,
  Loader2,
} from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import { formatUiDateDash, formatUiDateTime } from '@/lib/dates/ui-date';
import type {
  AthenaFailedNormalizedRow,
  AthenaInspectionDetail,
  AthenaReconciliationStatus,
} from '../types';

interface AthenaPayloadModalProps {
  row: AthenaFailedNormalizedRow | null;
  onClose: () => void;
}

function statusBadge(status: AthenaReconciliationStatus) {
  switch (status) {
    case 'REGISTERED':
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200/80 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60">
          <CheckCircle2 className="h-2.5 w-2.5" /> Registered
        </span>
      );
    case 'NOT_REGISTERED':
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-800 border border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60">
          <AlertTriangle className="h-2.5 w-2.5" /> Unregistered
        </span>
      );
    case 'MULTIPLE_MATCHES':
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-800 border border-violet-200/80 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800/60">
          <Copy className="h-2.5 w-2.5" /> Multiple
        </span>
      );
    case 'INVALID_DATA':
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60">
          <FileQuestion className="h-2.5 w-2.5" /> Invalid
        </span>
      );
  }
}

export function AthenaPayloadModal({ row, onClose }: AthenaPayloadModalProps) {
  const [detail, setDetail] = useState<AthenaInspectionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    axios
      .get<AthenaInspectionDetail>(`/api/report/athena-reconciliation?mode=detail&id=${row.id}`)
      .then((res) => {
        if (!cancelled) setDetail(res.data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row?.id]);

  if (!row) return null;

  const statusConfig = {
    REGISTERED: {
      label: 'Registered in CRM',
      icon: CheckCircle2,
      badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200',
    },
    NOT_REGISTERED: {
      label: 'Still Not Registered (Active Failure)',
      icon: AlertTriangle,
      badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300 border-rose-200',
    },
    MULTIPLE_MATCHES: {
      label: 'Multiple CRM Matches',
      icon: Copy,
      badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300 border-purple-200',
    },
    INVALID_DATA: {
      label: 'Invalid / Incomplete Data',
      icon: FileQuestion,
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-200',
    },
  }[row.reconciliationStatus] ?? {
    label: row.reconciliationStatus,
    icon: FileText,
    badgeClass: 'bg-slate-100 text-slate-800',
  };

  const StatusIcon = statusConfig.icon;
  const relatedFailures = detail?.relatedFailures ?? [];
  const crmCalls = detail?.crmCalls ?? [];
  const serialLabel = row.serialNo || 'this serial';

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return '—';
    return formatUiDateDash(d) || String(d);
  };

  const formatDateTime = (d: Date | string | null | undefined) => {
    if (!d) return '—';
    const s = formatUiDateTime(d);
    return s ? s.replace(/\//g, '-') : String(d);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start justify-between border-b border-slate-100 pb-4 dark:border-slate-800 pr-8">
          <div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusConfig.badgeClass}`}>
                <StatusIcon className="h-3.5 w-3.5" />
                {statusConfig.label}
              </span>
              <span className="text-xs text-slate-400">Record ID: #{row.id}</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
              {row.clientTicketNo ? `Ticket ${row.clientTicketNo}` : 'Failed Call Details'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {row.clientCaption || 'Client'} • {row.branchName || 'Branch'} • {row.callType || 'Call Type'}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            CRM Call Register Reconciliation Audit
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
            <div>
              <span className="text-slate-400">Reconciliation Status:</span>
              <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {row.reconciliationStatus}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Matches Found in CRM:</span>
              <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {row.matchCount} {row.matchCount === 1 ? 'call' : 'calls'}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Reconciled At:</span>
              <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {formatDateTime(row.reconciledAt)}
              </div>
            </div>
            {row.invalidReason && (
              <div className="col-span-full rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ⚠️ {row.invalidReason}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading comparison tables…
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {relatedFailures.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Athena ingestion failures (serial {serialLabel})
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  All CRM ingestion attempts for this machine — including retries on different dates.
                </p>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60">
                      <tr>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Call date</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Ticket</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Failure reason</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Result / value</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Status</th>
                        <th className="px-2.5 py-2 text-center font-semibold text-slate-600 dark:text-slate-300">CRM matches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedFailures.map((attempt) => (
                        <tr
                          key={attempt.id}
                          className={
                            attempt.isCurrent
                              ? 'bg-blue-50/70 dark:bg-blue-950/30'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="border-t border-slate-100 px-2.5 py-2 tabular-nums whitespace-nowrap dark:border-slate-800">
                            {formatDate(attempt.callDate)}
                            {attempt.isCurrent ? (
                              <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
                                this row
                              </span>
                            ) : null}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 font-mono dark:border-slate-800">
                            {attempt.clientTicketNo || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 text-rose-600 dark:text-rose-400 dark:border-slate-800">
                            {attempt.failureReason || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 max-w-[14rem] truncate text-slate-700 dark:text-slate-300 dark:border-slate-800" title={attempt.resultValue || attempt.result || ''}>
                            {attempt.resultValue || attempt.result || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
                            {statusBadge(attempt.reconciliationStatus)}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 text-center tabular-nums dark:border-slate-800">
                            {attempt.matchCount > 0 ? attempt.matchCount : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {crmCalls.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Matched CRM call register
                </h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  CRM calls matched to this ticket (ticket no = CCLID) — not every call on the same serial.
                </p>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60">
                      <tr>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">CRM call</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">CCLID</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Call date</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Status</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Type</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Outlet</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Serial</th>
                        <th className="px-2.5 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Complaint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crmCalls.map((crm) => (
                        <tr key={crm.vtrnno} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
                            <TrnLink
                              trn={crm.vtrnno}
                              className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200"
                            >
                              {crm.vtrnno}
                              <ExternalLink className="h-3 w-3" />
                            </TrnLink>
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 font-mono dark:border-slate-800">
                            {crm.vcclid || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 tabular-nums whitespace-nowrap dark:border-slate-800">
                            {formatDateTime(crm.loggedAt)}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 font-medium dark:border-slate-800">
                            {crm.statusLabel || crm.statusBucket || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
                            {crm.callType || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 max-w-[10rem] truncate dark:border-slate-800" title={crm.partyName || ''}>
                            {crm.partyName || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 font-mono dark:border-slate-800">
                            {crm.serial || '—'}
                          </td>
                          <td className="border-t border-slate-100 px-2.5 py-2 max-w-[10rem] truncate dark:border-slate-800" title={crm.complaint || ''}>
                            {crm.complaint || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Matching Criteria Fields (4-Way Comparison)
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-400">1. Call Type:</span>
                <div className="font-semibold text-slate-800 dark:text-slate-200">{row.callType || 'EMPTY'}</div>
              </div>
              <div>
                <span className="text-slate-400">2. Outlet Name:</span>
                <div className="font-semibold text-slate-800 dark:text-slate-200">{row.outletName || 'EMPTY'}</div>
              </div>
              <div>
                <span className="text-slate-400">3. Serial Number:</span>
                <div className="font-mono font-bold text-slate-900 dark:text-white">{row.serialNo || 'EMPTY'}</div>
              </div>
              <div>
                <span className="text-slate-400">4. Call Date (Received):</span>
                <div className="font-semibold text-slate-800 dark:text-slate-200">{formatDate(row.callDate)}</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Failure & Complaint Details
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-400">Failure Reason:</span>
                <div className="font-semibold text-rose-600 dark:text-rose-400">{row.failureReason || 'N/A'}</div>
              </div>
              <div>
                <span className="text-slate-400">Raw Result / Value:</span>
                <div className="text-slate-700 dark:text-slate-300">
                  {row.resultValue || row.result || 'N/A'}
                </div>
              </div>
              <div className="col-span-full">
                <span className="text-slate-400">Nature of Complaint:</span>
                <div className="text-slate-700 dark:text-slate-300">{row.natureOfComplaint || 'N/A'}</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Location & Machine Attributes
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-400">Client / Brand:</span>
                <div className="text-slate-800 dark:text-slate-200">{row.clientCaption || 'N/A'}</div>
              </div>
              <div>
                <span className="text-slate-400">Branch:</span>
                <div className="text-slate-800 dark:text-slate-200">{row.branchName || 'N/A'}</div>
              </div>
              <div>
                <span className="text-slate-400">Pincode / Phone:</span>
                <div className="text-slate-800 dark:text-slate-200">
                  {row.pincode || 'N/A'} {row.phone ? `(${row.phone})` : ''}
                </div>
              </div>
              <div>
                <span className="text-slate-400">Model:</span>
                <div className="text-slate-800 dark:text-slate-200">{row.model || 'N/A'}</div>
              </div>
              <div>
                <span className="text-slate-400">Invoice No:</span>
                <div className="text-slate-800 dark:text-slate-200">{row.invoiceNo || 'N/A'}</div>
              </div>
              <div>
                <span className="text-slate-400">Product Status:</span>
                <div className="text-slate-800 dark:text-slate-200">{row.productStatus || 'N/A'}</div>
              </div>
              <div className="col-span-full">
                <span className="text-slate-400">Outlet Address:</span>
                <div className="text-slate-700 dark:text-slate-300">{row.outletAddress || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
