'use client';

import React from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  FileQuestion,
  ExternalLink,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import type { AthenaFailedNormalizedRow } from '../types';

interface AthenaPayloadModalProps {
  row: AthenaFailedNormalizedRow | null;
  onClose: () => void;
}

export function AthenaPayloadModal({ row, onClose }: AthenaPayloadModalProps) {
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

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return 'N/A';
    const date = new Date(d);
    return isNaN(date.getTime()) ? String(d) : date.toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
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

        {/* Reconciliation Results Card */}
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
                {formatDate(row.reconciledAt)}
              </div>
            </div>

            {row.matchedVtrnno && (
              <div className="col-span-full border-t border-slate-200/60 pt-2.5 dark:border-slate-700/60">
                <span className="text-slate-400">Matched CRM Call(s):</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {row.matchedVtrnnos && row.matchedVtrnnos.length > 0 ? (
                    row.matchedVtrnnos.map((trn) => (
                      <TrnLink
                        key={trn}
                        trn={trn}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 hover:bg-blue-200 dark:bg-blue-900/60 dark:text-blue-200"
                      >
                        {trn}
                        <ExternalLink className="h-3 w-3" />
                      </TrnLink>
                    ))
                  ) : (
                    <TrnLink
                      trn={row.matchedVtrnno}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 hover:bg-blue-200 dark:bg-blue-900/60 dark:text-blue-200"
                    >
                      {row.matchedVtrnno}
                      <ExternalLink className="h-3 w-3" />
                    </TrnLink>
                  )}
                </div>
                {row.matchedCrmLoggedAt && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    CRM Call Date: {formatDate(row.matchedCrmLoggedAt)} | Status: {row.matchedCrmStatus || 'N/A'}
                  </p>
                )}
              </div>
            )}

            {row.invalidReason && (
              <div className="col-span-full rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ⚠️ {row.invalidReason}
              </div>
            )}
          </div>
        </div>

        {/* Source Payload Grid */}
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

        {/* Footer */}
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
