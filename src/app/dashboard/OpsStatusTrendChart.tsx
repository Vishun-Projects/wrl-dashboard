'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { DashboardPanel } from '@/app/dashboard/DashboardPanel';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';

export type TrendDay = {
  date: string;
  open: number;
  unallocated: number;
  assigned: number;
  solved: number;
  cancelled: number;
  tech_solved: number;
  total: number;
};

export type TrendCallTypePoint = {
  date: string;
  call_type: string;
  open: number;
  unallocated: number;
  assigned: number;
  solved: number;
  cancelled: number;
  tech_solved: number;
  total: number;
};

type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

/** Daily activity series (chart). Table below uses live portfolio mix separately. */
const STATUS_META = [
  { key: 'unallocated' as const, label: 'New', color: '#b45309' },
  { key: 'solved' as const, label: 'Solved', color: '#059669' },
  { key: 'cancelled' as const, label: 'Cancelled', color: '#e11d48' },
  { key: 'tech_solved' as const, label: 'Tech solved', color: '#0369a1' },
];

export type PortfolioCallTypeRow = {
  call_type: string;
  total_calls: number;
  open_unallocated: number;
  assigned: number;
  solved_calls: number;
  tech_solved: number;
  cancelled_calls: number;
};

export type TrendGrain = 'day' | 'week' | 'month';

const GRAIN_OPTIONS: Array<{ id: TrendGrain; label: string }> = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
];

/** Monday (UTC noon) for ISO-ish week bucket. */
export function weekBucketStart(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function monthBucketStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Sum daily activity into week/month buckets (order preserved). */
export function clubTrendDays(days: TrendDay[], grain: TrendGrain): TrendDay[] {
  if (grain === 'day' || days.length === 0) return days;
  const keyOf = grain === 'week' ? weekBucketStart : monthBucketStart;
  const map = new Map<string, TrendDay>();
  const order: string[] = [];
  for (const row of days) {
    const key = keyOf(row.date);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        date: key,
        open: row.open,
        unallocated: row.unallocated,
        assigned: row.assigned,
        solved: row.solved,
        cancelled: row.cancelled,
        tech_solved: row.tech_solved,
        total: row.total,
      });
      order.push(key);
      continue;
    }
    prev.open += row.open;
    prev.unallocated += row.unallocated;
    prev.assigned += row.assigned;
    prev.solved += row.solved;
    prev.cancelled += row.cancelled;
    prev.tech_solved += row.tech_solved;
    prev.total += row.total;
  }
  return order.map((k) => map.get(k)!);
}

function spanNeedsYear(dates: string[]): boolean {
  if (dates.length < 2) return false;
  const firstY = dates[0]!.slice(0, 4);
  const lastY = dates[dates.length - 1]!.slice(0, 4);
  return firstY !== lastY || dates.length > 60;
}

function formatAxisDate(iso: string, withYear: boolean, grain: TrendGrain = 'day'): string {
  try {
    const d = new Date(`${iso}T12:00:00`);
    if (grain === 'month') {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        year: 'numeric',
      }).format(d);
    }
    if (grain === 'week') {
      return `w/o ${new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        ...(withYear ? { year: '2-digit' as const } : {}),
      }).format(d)}`;
    }
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' as const } : {}),
    }).format(d);
  } catch {
    return withYear ? iso : iso.slice(5);
  }
}

function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

function niceMax(raw: number): number {
  if (raw <= 0) return 10;
  const pad = raw * 1.05;
  const mag = 10 ** Math.floor(Math.log10(pad));
  const norm = pad / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function SeriesChip({
  label,
  color,
  on,
  onClick,
}: {
  label: string;
  color: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${
        on ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through opacity-50'
      }`}
    >
      <span
        className="inline-block h-0.5 w-2 rounded-full"
        style={{ backgroundColor: on ? color : '#cbd5e1' }}
        aria-hidden
      />
      {label}
    </button>
  );
}

function TrendSparkline({
  dates,
  series,
  size = 'sm',
  grain = 'day',
}: {
  dates: string[];
  series: ChartSeries[];
  size?: 'sm' | 'lg';
  grain?: TrendGrain;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const withYear = spanNeedsYear(dates) || grain !== 'day';
  const large = size === 'lg';
  const height = large ? 260 : 144;
  const padL = withYear ? (large ? 44 : 40) : large ? 36 : 32;
  const padR = large ? 12 : 8;
  const padT = large ? 12 : 8;
  const padB = withYear ? (large ? 28 : 24) : large ? 22 : 20;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = height - padT - padB;
  const maxY = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const sync = () => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setWidth(w);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  const xAt = (i: number) =>
    dates.length <= 1 ? padL + plotW / 2 : padL + (i / Math.max(1, dates.length - 1)) * plotW;
  const yAt = (v: number) => padT + plotH - (v / maxY) * plotH;

  const pathFor = (values: number[]) => {
    if (!values.length) return '';
    if (values.length === 1) {
      const y = yAt(values[0]!);
      return `M ${xAt(0) - 10} ${y} L ${xAt(0) + 10} ${y}`;
    }
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(' ');
  };

  const tickIdx =
    dates.length <= 4
      ? dates.map((_, i) => i)
      : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];

  const hover = hoverIdx != null ? dates[hoverIdx] : null;

  return (
    <div ref={wrapRef} className="relative w-full px-2.5 pb-1.5 pt-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block w-full select-none"
        role="img"
        aria-label="Ops status trend"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line
          x1={padL}
          x2={width - padR}
          y1={padT + plotH}
          y2={padT + plotH}
          stroke="currentColor"
          className="text-slate-100 dark:text-slate-800"
          strokeWidth={1}
        />
        <text
          x={padL - 3}
          y={padT + 3}
          textAnchor="end"
          className="fill-slate-400"
          style={{ fontSize: 8 }}
        >
          {maxY >= 1000 ? `${Math.round(maxY / 100) / 10}k` : maxY}
        </text>

        {series.map((s) => (
          <path
            key={s.key}
            d={pathFor(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {dates.map((d, i) => {
          const band = dates.length <= 1 ? plotW : plotW / Math.max(1, dates.length - 1);
          return (
            <rect
              key={d}
              x={xAt(i) - band / 2}
              y={padT}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}

        {hoverIdx != null ? (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={padT}
            y2={padT + plotH}
            stroke="currentColor"
            className="text-slate-300 dark:text-slate-600"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        ) : null}

        {tickIdx.map((i) => (
          <text
            key={dates[i]}
            x={xAt(i)}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-400"
            style={{ fontSize: withYear ? 7 : 8 }}
          >
            {formatAxisDate(dates[i]!, withYear, grain)}
          </text>
        ))}
      </svg>

      {hoverIdx != null && hover ? (
        <div className="pointer-events-none absolute right-2 top-0.5 z-10 max-w-[11rem] rounded border border-slate-200 bg-bg-canvas px-2 py-1 text-[10px] shadow-sm dark:border-slate-700">
          <p className="font-semibold text-slate-800 dark:text-slate-100">
            {formatAxisDate(hover, true, grain)}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {series.map((s) => (
              <li
                key={s.key}
                className="flex justify-between gap-2 tabular-nums text-slate-600 dark:text-slate-300"
              >
                <span className="truncate">{s.label}</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {formatCount(s.values[hoverIdx] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CallTypeStatusTable({ rows }: { rows: PortfolioCallTypeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-hidden border-t border-slate-100 dark:border-slate-800">
      <table className="w-full table-fixed border-collapse text-[11px]">
        <thead>
          <tr className="bg-bg-soft text-left text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
            <th className="px-2.5 py-1.5 font-bold">Call type</th>
            <th className="px-1.5 py-1.5 text-right font-bold">Unalloc</th>
            <th className="px-1.5 py-1.5 text-right font-bold">Assigned</th>
            <th className="px-1.5 py-1.5 text-right font-bold">Solved</th>
            <th className="px-1.5 py-1.5 text-right font-bold">Tech</th>
            <th className="px-1.5 py-1.5 text-right font-bold">Cancel</th>
            <th className="px-2.5 py-1.5 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.call_type}
              className="border-t border-slate-100 text-slate-800 dark:border-slate-800/80 dark:text-slate-100"
            >
              <td className="truncate px-2.5 py-1 font-semibold" title={row.call_type}>
                {row.call_type}
              </td>
              <td className="px-1.5 py-1 text-right tabular-nums text-amber-700 dark:text-amber-400">
                {formatCount(row.open_unallocated ?? 0)}
              </td>
              <td className="px-1.5 py-1 text-right tabular-nums">
                {formatCount(row.assigned ?? 0)}
              </td>
              <td className="px-1.5 py-1 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCount(row.solved_calls ?? 0)}
              </td>
              <td className="px-1.5 py-1 text-right tabular-nums text-sky-700 dark:text-sky-400">
                {formatCount(row.tech_solved ?? 0)}
              </td>
              <td className="px-1.5 py-1 text-right tabular-nums text-rose-700 dark:text-rose-400">
                {formatCount(row.cancelled_calls ?? 0)}
              </td>
              <td className="px-2.5 py-1 text-right tabular-nums font-semibold">
                {formatCount(row.total_calls ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpsStatusTrendChart({
  days,
  portfolioCallTypes = [],
  loading = false,
}: {
  days: TrendDay[];
  /** Live period portfolio by call type (same grain as Status strip). */
  portfolioCallTypes?: PortfolioCallTypeRow[];
  loading?: boolean;
}) {
  const [hiddenOverride, setHiddenOverride] = useState<Set<string> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [grain, setGrain] = useState<TrendGrain>('day');

  const clubbed = useMemo(() => clubTrendDays(days, grain), [days, grain]);

  const statusSeries: ChartSeries[] = useMemo(() => {
    if (clubbed.length === 0) return [];
    return STATUS_META.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      values: clubbed.map((d) => d[s.key]),
    }));
  }, [clubbed]);

  const hidden = useMemo(() => hiddenOverride ?? new Set<string>(), [hiddenOverride]);

  const visible = useMemo(
    () => statusSeries.filter((s) => !hidden.has(s.key)),
    [statusSeries, hidden]
  );

  const tableRows = useMemo(
    () =>
      [...portfolioCallTypes].sort(
        (a, b) => b.total_calls - a.total_calls || a.call_type.localeCompare(b.call_type)
      ),
    [portfolioCallTypes]
  );

  const toggle = (key: string) => {
    setHiddenOverride(() => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (statusSeries.every((s) => next.has(s.key))) next.delete(key);
      return next;
    });
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

  if (loading && days.length === 0) {
    return (
      <div className="min-h-[10rem] animate-pulse rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800" />
    );
  }

  if (days.length === 0) {
    return (
      <DashboardPanel title="Ops trend" subtitle="Daily activity">
        <p className="px-4 py-6 text-center text-[12px] text-slate-500">
          Trends start after the first daily activity seal.
        </p>
      </DashboardPanel>
    );
  }

  const latest = clubbed[clubbed.length - 1]!;
  const dates = clubbed.map((d) => d.date);
  const grainLabel = GRAIN_OPTIONS.find((g) => g.id === grain)?.label ?? 'Daily';
  const unit =
    grain === 'day' ? `${clubbed.length}d` : grain === 'week' ? `${clubbed.length}w` : `${clubbed.length}mo`;
  const subtitle = `${grainLabel} · ${unit} · new ${formatCount(latest.unallocated)} · solved ${formatCount(latest.solved)}`;

  const grainToggle = (
    <div
      className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700"
      role="group"
      aria-label="Trend grain"
    >
      {GRAIN_OPTIONS.map((opt) => {
        const active = grain === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setGrain(opt.id)}
            aria-pressed={active}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              active
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  const legend = (
    <div className="flex flex-wrap items-center gap-x-0.5 gap-y-0 border-t border-slate-100 px-2.5 py-1 dark:border-slate-800">
      {statusSeries.map((s) => (
        <SeriesChip
          key={s.key}
          label={s.label}
          color={s.color}
          on={!hidden.has(s.key)}
          onClick={() => toggle(s.key)}
        />
      ))}
    </div>
  );

  return (
    <>
      <DashboardPanel
        title="Ops trend"
        subtitle={subtitle}
        className="h-fit w-full"
        bodyClassName="min-w-0"
        actions={
          <div className="flex items-center gap-1.5">
            {grainToggle}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label="Maximize ops trend"
              title="Maximize — chart + table"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        }
      >
        <TrendSparkline dates={dates} series={visible} size="sm" grain={grain} />
        {legend}
      </DashboardPanel>

      {modalOpen ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 sm:p-6">
          <ModalBackdrop onClick={() => setModalOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Ops trend maximized"
            className="relative flex max-h-[min(920px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-xl animate-in zoom-in-95 duration-200 dark:border-slate-700"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  Ops trend
                </h3>
                <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {grainToggle}
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TrendSparkline dates={dates} series={visible} size="lg" grain={grain} />
              {legend}
              <CallTypeStatusTable rows={tableRows} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
