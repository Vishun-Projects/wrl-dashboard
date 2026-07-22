'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  buildInvolvementPairKey,
  SERIAL_AUDIT_INVOLVEMENT_PAGE_SIZES,
  type RepeatInvolvementEntry,
  type SerialAuditInvolvementPageSize,
  type SerialAuditRepeatInvolvement,
} from '@/features/serial-audit/lib/complaint-audit';

type SerialAuditAnalysisPanelProps = {
  analysis: SerialAuditRepeatInvolvement;
  dateRangeLabel: string;
  loading?: boolean;
  prefetching?: boolean;
  selectedPairKey?: string | null;
  onPairSelect?: (entry: RepeatInvolvementEntry | null) => void;
};

const INVOLVEMENT_COLUMN_HELP = {
  asp: 'Authorised Service Provider',
  machines: 'Distinct serial numbers with repeat calls handled by this pair',
  compressor: 'Serials where this pair logged compressor work on a repeat call',
  gas: 'Serials where this pair logged gas charging on a repeat call',
  motor: 'Serials where this pair logged motor work on a repeat call',
} as const;

function InvolvementColumnHeader({
  label,
  help,
  align = 'left',
}: {
  label: string;
  help?: string;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-1 py-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      title={help}
    >
      {label}
    </th>
  );
}

function InvolvementTable({
  entries,
  rankOffset,
  selectedPairKey,
  onPairSelect,
}: {
  entries: SerialAuditRepeatInvolvement['entries'];
  rankOffset: number;
  selectedPairKey?: string | null;
  onPairSelect?: (entry: RepeatInvolvementEntry | null) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-[11px] text-slate-500">
        No ASP / technician repeat involvement in flagged serials.
      </p>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse text-left text-[11px]">
      <colgroup>
        <col style={{ width: '34%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '14%' }} />
      </colgroup>
      <thead>
        <tr className="border-b border-slate-200 bg-bg-soft">
          <InvolvementColumnHeader label="ASP — Technician" help={INVOLVEMENT_COLUMN_HELP.asp} />
          <InvolvementColumnHeader
            label="M/C's"
            help={INVOLVEMENT_COLUMN_HELP.machines}
            align="right"
          />
          <InvolvementColumnHeader
            label="Comp."
            help={INVOLVEMENT_COLUMN_HELP.compressor}
            align="right"
          />
          <InvolvementColumnHeader label="Gas" help={INVOLVEMENT_COLUMN_HELP.gas} align="right" />
          <InvolvementColumnHeader label="Motor" help={INVOLVEMENT_COLUMN_HELP.motor} align="right" />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => {
          const rank = rankOffset + index + 1;
          const pairKey = buildInvolvementPairKey(entry.technician, entry.franchisee);
          const isSelected = selectedPairKey === pairKey;
          const clickable = !!onPairSelect;
          return (
            <tr
              key={`${entry.franchisee}-${entry.technician}-${rank}`}
              className={`border-b border-slate-100 ${
                clickable ? 'cursor-pointer transition-colors hover:bg-amber-50/60' : ''
              } ${isSelected ? 'bg-amber-50 ring-1 ring-inset ring-amber-200' : ''}`}
              onClick={
                clickable
                  ? () => onPairSelect(isSelected ? null : entry)
                  : undefined
              }
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPairSelect(isSelected ? null : entry);
                      }
                    }
                  : undefined
              }
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? 'button' : undefined}
              aria-pressed={clickable ? isSelected : undefined}
              aria-label={
                clickable
                  ? `${entry.franchisee}, ${entry.technician}, ${entry.serialCount} machines. ${
                      isSelected ? 'Showing these serials in the list. Click to clear.' : 'Click to show their serial numbers.'
                    }`
                  : undefined
              }
            >
              <td className="px-2 py-2 align-top">
                <span className="text-[9px] font-semibold text-slate-400">#{rank}</span>
                <div className="mt-0.5 min-w-0 break-words">
                  {entry.franchisee !== '—' ? (
                    <>
                      <p className="text-[10px] font-semibold leading-snug text-slate-900">{entry.franchisee}</p>
                      {entry.technician !== '—' ? (
                        <p className="mt-0.5 text-[10px] leading-snug text-slate-600">{entry.technician}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-[10px] font-medium text-slate-900">{entry.technician}</p>
                  )}
                </div>
              </td>
              <td className="px-1 py-2 text-right align-top text-[11px] font-semibold tabular-nums text-slate-900">
                {entry.serialCount}
              </td>
              <td
                className={`px-1 py-2 text-right align-top text-[11px] tabular-nums ${
                  entry.compressor > 0 ? 'font-semibold text-rose-700' : 'text-slate-400'
                }`}
              >
                {entry.compressor || '—'}
              </td>
              <td
                className={`px-1 py-2 text-right align-top text-[11px] tabular-nums ${
                  entry.gasCharging > 0 ? 'font-semibold text-teal-700' : 'text-slate-400'
                }`}
              >
                {entry.gasCharging || '—'}
              </td>
              <td
                className={`px-1 py-2 text-right align-top text-[11px] tabular-nums ${
                  entry.motor > 0 ? 'font-semibold text-violet-700' : 'text-slate-400'
                }`}
              >
                {entry.motor || '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SerialAuditAnalysisPanel({
  analysis,
  dateRangeLabel,
  loading = false,
  prefetching = false,
  selectedPairKey = null,
  onPairSelect,
}: SerialAuditAnalysisPanelProps) {
  const [pageSize, setPageSize] = useState<SerialAuditInvolvementPageSize>(10);
  const [page, setPage] = useState(1);

  const totalEntries = analysis.entries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));

  const pageSizeOptions = useMemo(() => {
    const sizes = new Set<number>(SERIAL_AUDIT_INVOLVEMENT_PAGE_SIZES);
    if (totalEntries > 50 && totalEntries <= 250) sizes.add(totalEntries);
    return [...sizes].sort((a, b) => a - b);
  }, [totalEntries]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, totalEntries, dateRangeLabel]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedEntries = useMemo(() => {
    const start = (page - 1) * pageSize;
    return analysis.entries.slice(start, start + pageSize);
  }, [analysis.entries, page, pageSize]);

  const rankOffset = (page - 1) * pageSize;

  return (
    <section className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm lg:max-h-full">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="rounded-md bg-amber-50 p-1.5 text-amber-700">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[12px] font-semibold leading-snug text-slate-900">
              ASP / technicians — repeat calls
            </h2>
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              {selectedPairKey
                ? 'Click row again to show all serials'
                : totalEntries > 0
                  ? `${totalEntries.toLocaleString()} pairs · click a row to filter serials`
                  : 'Top flagged serials — motor / compressor / gas by ASP'}
            </p>
          </div>
        </div>
        {prefetching ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading flagged serial call details…
          </p>
        ) : analysis.detailsPending && !loading && analysis.serialsInScope > 0 ? (
          <p className="mt-2 text-[11px] text-slate-500">
            Loading flagged serial details ({analysis.serialsWithDetails}/
            {analysis.serialsInScope}).
          </p>
        ) : analysis.serialsInScope === 0 && !loading ? (
          <p className="mt-2 text-[11px] text-slate-500">No flagged repeat-complaint serials in range.</p>
        ) : null}
      </div>

      {loading && analysis.repeatCallCount === 0 && analysis.serialsWithDetails === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-[11px] text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          Waiting for serial audit data…
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <InvolvementTable
            entries={pagedEntries}
            rankOffset={rankOffset}
            selectedPairKey={selectedPairKey}
            onPairSelect={onPairSelect}
          />
        </div>
      )}

      {totalEntries > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
            <span className="text-slate-400">Show</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as SerialAuditInvolvementPageSize)}
              className="rounded border border-slate-200 bg-bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size === totalEntries ? `All (${size})` : size}
                </option>
              ))}
            </select>
          </label>
          {totalEntries > pageSize ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-500">
                {rankOffset + 1}–{Math.min(rankOffset + pageSize, totalEntries)} of {totalEntries}
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-200 bg-bg-canvas p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[2.5rem] text-center text-[10px] font-medium text-slate-700">
                {page}/{totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-200 bg-bg-canvas p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <span className="text-[10px] text-slate-500">{totalEntries} total</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
