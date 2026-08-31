'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Table2 } from 'lucide-react';
import { HorizontalScrollFade } from '@/components/ui/HorizontalScrollFade';
import { formatLocalDate, parseLocalDateString } from '@/modules/mis';
import { formatUiDateDash } from '@/lib/dates/ui-date';
import type {
  AthenaReasonDateMatrix,
  AthenaReconciliationFilterParams,
} from '../types';

const WINDOW_DAYS = 15;

export function buildReasonDateWindow(
  anchorEnd: string,
  boundStart?: string | null,
  boundEnd?: string | null
): { start: string; end: string } {
  const boundEndD = boundEnd ? parseLocalDateString(boundEnd) : new Date();
  const boundStartD = boundStart
    ? parseLocalDateString(boundStart)
    : new Date(boundEndD.getFullYear(), 0, 1);

  let end = parseLocalDateString(anchorEnd);
  if (end > boundEndD) end = boundEndD;
  if (end < boundStartD) end = boundStartD;

  const start = new Date(end);
  start.setDate(start.getDate() - (WINDOW_DAYS - 1));
  if (start < boundStartD) start.setTime(boundStartD.getTime());

  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

function shiftWindowEnd(
  current: { start: string; end: string },
  direction: -1 | 1,
  boundStart?: string | null,
  boundEnd?: string | null
): { start: string; end: string } | null {
  const end = parseLocalDateString(current.end);
  if (direction < 0) {
    const prevEnd = new Date(parseLocalDateString(current.start));
    prevEnd.setDate(prevEnd.getDate() - 1);
    if (boundStart && prevEnd < parseLocalDateString(boundStart)) return null;
    return buildReasonDateWindow(formatLocalDate(prevEnd), boundStart, boundEnd);
  }
  const nextEnd = new Date(end);
  nextEnd.setDate(nextEnd.getDate() + WINDOW_DAYS);
  if (boundEnd && nextEnd > parseLocalDateString(boundEnd)) {
    const cap = parseLocalDateString(boundEnd);
    if (formatLocalDate(cap) === current.end) return null;
    return buildReasonDateWindow(formatLocalDate(cap), boundStart, boundEnd);
  }
  return buildReasonDateWindow(formatLocalDate(nextEnd), boundStart, boundEnd);
}

type Props = {
  filters: AthenaReconciliationFilterParams;
};

export function AthenaReasonDateMatrixPanel({ filters }: Props) {
  const boundStart = filters.startDate;
  const boundEnd = filters.endDate ?? formatLocalDate(new Date());
  const [windowEndAnchor, setWindowEndAnchor] = useState(boundEnd);
  const [matrix, setMatrix] = useState<AthenaReasonDateMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  const window = useMemo(
    () => buildReasonDateWindow(windowEndAnchor, boundStart, boundEnd),
    [windowEndAnchor, boundStart, boundEnd]
  );

  useEffect(() => {
    setWindowEndAnchor(boundEnd);
  }, [boundEnd]);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('mode', 'reason-matrix');
      params.set('matrixStart', window.start);
      params.set('matrixEnd', window.end);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.branches?.length) params.set('branch', filters.branches.join(','));
      if (filters.clients?.length) params.set('client', filters.clients.join(','));
      if (filters.callTypes?.length) params.set('callType', filters.callTypes.join(','));
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      if (filters.excludedReasons?.length) {
        params.set('excludedReasons', filters.excludedReasons.join(','));
      }
      if (filters.treatAsRegisteredReasons?.length) {
        params.set('treatAsRegisteredReasons', filters.treatAsRegisteredReasons.join(','));
      }
      const res = await axios.get<AthenaReasonDateMatrix>(
        `/api/report/athena-reconciliation?${params.toString()}`
      );
      setMatrix(res.data);
    } catch {
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }, [
    window.start,
    window.end,
    filters.startDate,
    filters.endDate,
    filters.branches,
    filters.clients,
    filters.callTypes,
    filters.status,
    filters.excludedReasons,
    filters.treatAsRegisteredReasons,
  ]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  const prevWindow = shiftWindowEnd(window, -1, boundStart, boundEnd);
  const nextWindow = shiftWindowEnd(window, 1, boundStart, boundEnd);
  const canGoPrev = Boolean(prevWindow && prevWindow.end !== window.end);
  const canGoNext = Boolean(nextWindow && nextWindow.end !== window.end);

  /** Newest date left (after Failure reason), oldest right before Total. */
  const displayDates = useMemo(() => {
    const dates = matrix?.dates ?? windowDatesPlaceholder(window);
    return [...dates].reverse();
  }, [matrix?.dates, window]);

  const colLabel = (iso: string) => formatUiDateDash(iso);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Table2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span>Failure reason × call date</span>
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            {formatUiDateDash(window.start)} – {formatUiDateDash(window.end)} (Mon–Sat)
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">
          <button
            type="button"
            disabled={!canGoNext || loading}
            onClick={() => {
              const next = shiftWindowEnd(window, 1, boundStart, boundEnd);
              if (next) setWindowEndAnchor(next.end);
            }}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            aria-label="Newer 15 days"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">15-day window</span>
          <button
            type="button"
            disabled={!canGoPrev || loading}
            onClick={() => {
              const prev = shiftWindowEnd(window, -1, boundStart, boundEnd);
              if (prev) setWindowEndAnchor(prev.end);
            }}
            className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            aria-label="Older 15 days"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <HorizontalScrollFade edge="both" scrollClassName="max-h-[min(420px,50vh)] overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
            <tr>
              <th className="sticky left-0 z-20 min-w-[12rem] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                Failure reason
              </th>
              {(displayDates).map((d) => (
                <th
                  key={d}
                  className="min-w-[5.5rem] border-b border-slate-200 px-2 py-2 text-center font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  {colLabel(d)}
                </th>
              ))}
              <th className="min-w-[3.5rem] border-b border-l border-slate-200 bg-slate-100/80 px-2 py-2 text-center font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={displayDates.length + 2}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  Loading matrix…
                </td>
              </tr>
            ) : !matrix || matrix.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={displayDates.length + 2}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  No calls in this window
                </td>
              </tr>
            ) : (
              <>
                {matrix.rows.map((row) => (
                  <tr key={row.reason} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="sticky left-0 z-[1] max-w-[14rem] truncate border-b border-r border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
                      {row.reason}
                    </td>
                    {displayDates.map((d) => {
                      const n = row.byDate[d] ?? 0;
                      return (
                        <td
                          key={d}
                          className={`border-b border-slate-100 px-2 py-1.5 text-center tabular-nums dark:border-slate-800 ${
                            n > 0 ? 'text-slate-800 dark:text-slate-100' : 'text-slate-300 dark:text-slate-600'
                          }`}
                        >
                          {n > 0 ? n.toLocaleString('en-IN') : '—'}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-100 bg-slate-50/50 px-2 py-1.5 text-center font-semibold tabular-nums text-slate-900 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-100">
                      {row.total.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold dark:bg-slate-800/50">
                  <td className="sticky left-0 z-[1] border-r border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
                    Total
                  </td>
                  {displayDates.map((d) => (
                    <td
                      key={d}
                      className="px-2 py-2 text-center tabular-nums text-slate-800 dark:text-slate-100"
                    >
                      {(matrix.columnTotals[d] ?? 0).toLocaleString('en-IN')}
                    </td>
                  ))}
                  <td className="border-l border-slate-200 px-2 py-2 text-center tabular-nums text-slate-900 dark:border-slate-700 dark:text-slate-100">
                    {matrix.grandTotal.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr className="bg-teal-50/60 font-medium dark:bg-teal-950/30">
                  <td className="sticky left-0 z-[1] border-b border-r border-teal-100 bg-teal-50/60 px-3 py-1.5 text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-200">
                    Registered
                  </td>
                  {displayDates.map((d) => {
                    const n = matrix.registeredByDate[d] ?? 0;
                    return (
                      <td
                        key={d}
                        className="border-b border-teal-100 px-2 py-1.5 text-center tabular-nums text-teal-800 dark:border-teal-900 dark:text-teal-200"
                      >
                        {n > 0 ? n.toLocaleString('en-IN') : '—'}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-teal-100 bg-teal-100/50 px-2 py-1.5 text-center font-semibold tabular-nums text-teal-900 dark:border-teal-900 dark:bg-teal-900/40 dark:text-teal-100">
                    {matrix.registeredTotal.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr className="bg-rose-50/60 font-medium dark:bg-rose-950/30">
                  <td className="sticky left-0 z-[1] border-b border-r border-rose-100 bg-rose-50/60 px-3 py-1.5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                    Unregistered
                  </td>
                  {displayDates.map((d) => {
                    const n = matrix.unregisteredByDate[d] ?? 0;
                    return (
                      <td
                        key={d}
                        className="border-b border-rose-100 px-2 py-1.5 text-center tabular-nums text-rose-800 dark:border-rose-900 dark:text-rose-200"
                      >
                        {n > 0 ? n.toLocaleString('en-IN') : '—'}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-rose-100 bg-rose-100/50 px-2 py-1.5 text-center font-semibold tabular-nums text-rose-900 dark:border-rose-900 dark:bg-rose-900/40 dark:text-rose-100">
                    {matrix.unregisteredTotal.toLocaleString('en-IN')}
                  </td>
                </tr>
                {matrix.invalidDataTotal > 0 ? (
                  <tr className="bg-amber-50/60 font-medium dark:bg-amber-950/30">
                    <td className="sticky left-0 z-[1] border-b border-r border-amber-100 bg-amber-50/60 px-3 py-1.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      Invalid data
                    </td>
                    {displayDates.map((d) => {
                      const n = matrix.invalidDataByDate[d] ?? 0;
                      return (
                        <td
                          key={d}
                          className="border-b border-amber-100 px-2 py-1.5 text-center tabular-nums text-amber-800 dark:border-amber-900 dark:text-amber-200"
                        >
                          {n > 0 ? n.toLocaleString('en-IN') : '—'}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-amber-100 bg-amber-100/50 px-2 py-1.5 text-center font-semibold tabular-nums text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      {matrix.invalidDataTotal.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </HorizontalScrollFade>
    </div>
  );
}

function windowDatesPlaceholder(window: { start: string; end: string }): string[] {
  const dates: string[] = [];
  const cur = parseLocalDateString(window.start);
  const end = parseLocalDateString(window.end);
  while (cur <= end) {
    if (cur.getDay() !== 0) dates.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}
