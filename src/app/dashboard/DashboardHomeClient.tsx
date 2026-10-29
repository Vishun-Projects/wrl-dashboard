'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { motion } from 'motion/react';
import { useUser } from '@/components/layout/DashboardLayout';
import { PageLoadingState, PageScrollRegion, PageShell } from '@/components/layout/PageShell';
import { AnimatedMetric } from '@/components/motion';
import { FilterSelect } from '@/components/filters';
import { hasAnyMisAccess } from '@/lib/auth/rbac-catalog';
import {
  instantTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';
import { DashboardAgingPanel } from '@/app/dashboard/DashboardAgingPanel';
import { DashboardPanel } from '@/app/dashboard/DashboardPanel';
import { DashboardStatsStrip } from '@/app/dashboard/DashboardStatsStrip';
import {
  OpsStatusTrendChart,
  type TrendCallTypePoint,
  type TrendDay,
} from '@/app/dashboard/OpsStatusTrendChart';

const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.04, delayChildren: 0.03 },
  },
};

type OpsKpiRow = {
  total_calls: number;
  solved_calls: number;
  cancelled_calls: number;
  open_calls: number;
  open_unallocated: number;
  assigned: number;
  tech_solved: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
};

type OpsKpisPayload = OpsKpiRow & {
  startDate: string;
  endDate: string;
  regions: Array<OpsKpiRow & { region: string }>;
  topBranches: Array<OpsKpiRow & { branch: string; region: string }>;
  callTypes: Array<{
    call_type: string;
    total_calls: number;
    open_calls: number;
    open_unallocated: number;
    assigned: number;
    solved_calls: number;
    tech_solved: number;
    cancelled_calls: number;
  }>;
};

type OpsTrendPayload = {
  days: TrendDay[];
  callTypes: TrendCallTypePoint[];
  topTypes: string[];
};

type OpsPeriod = 'month' | 'year' | 'all';

const PERIOD_OPTIONS: Array<{ id: OpsPeriod; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

function dashboardCacheKey(period: OpsPeriod, callTypes: string[]): string {
  const types = [...callTypes].map((t) => t.toUpperCase()).sort().join(',');
  return `${period}::${types}`;
}

function appendCallTypesParam(url: string, callTypes: string[]): string {
  if (!callTypes.length) return url;
  const q = encodeURIComponent(callTypes.join(','));
  return `${url}${url.includes('?') ? '&' : '?'}callTypes=${q}`;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function closeRatePct(solved: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((solved / total) * 1000) / 10;
}

function formatPeriodLabel(period: OpsPeriod, startDate: string, endDate: string): string {
  try {
    const start = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    if (period === 'all') {
      return `All time · through ${new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(end)}`;
    }
    if (period === 'year') {
      return `${start.getFullYear()} · through ${new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(end)}`;
    }
    const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
      start
    );
    const endDay = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(end);
    return `${month} · through ${endDay}`;
  } catch {
    return `${startDate} → ${endDate}`;
  }
}

function Num({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`.trim()}>
      <AnimatedMetric value={value} />
    </span>
  );
}

function OverviewTable({
  title,
  subtitle,
  columns,
  rows,
  empty,
  footer,
  reduceMotion = false,
}: {
  title: string;
  subtitle?: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  rows: React.ReactNode;
  empty: boolean;
  footer?: React.ReactNode;
  reduceMotion?: boolean;
}) {
  return (
    <DashboardPanel title={title} subtitle={subtitle} reduceMotion={reduceMotion}>
      <div className="overflow-x-hidden">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr className="bg-bg-soft text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-2.5 py-2 font-bold ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                  No calls in scope for this period.
                </td>
              </tr>
            ) : (
              rows
            )}
          </tbody>
          {!empty && footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </DashboardPanel>
  );
}

function PeriodToggle({
  period,
  onChange,
  disabled = false,
  reduceMotion = false,
}: {
  period: OpsPeriod;
  onChange: (p: OpsPeriod) => void;
  disabled?: boolean;
  reduceMotion?: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-bg-canvas p-0.5 shadow-sm dark:border-slate-800"
      role="group"
      aria-label="Dashboard period"
    >
      {PERIOD_OPTIONS.map((opt) => {
        const active = period === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            disabled={disabled && active}
            className={`relative rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              active
                ? 'text-white dark:text-slate-900'
                : 'text-slate-600 hover:bg-bg-soft hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            {active ? (
              <motion.span
                layoutId={reduceMotion ? undefined : 'dashboard-period-pill'}
                className="absolute inset-0 rounded-md bg-slate-900 dark:bg-slate-100"
                transition={
                  reduceMotion
                    ? instantTransition()
                    : { type: 'spring', stiffness: 420, damping: 34 }
                }
              />
            ) : null}
            <span className="relative z-[1]">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardHomeClient() {
  const { userProfile, loadingProfile } = useUser();
  const [period, setPeriod] = useState<OpsPeriod>('month');
  const [selectedCallTypes, setSelectedCallTypes] = useState<string[]>([]);
  const [callTypeOptions, setCallTypeOptions] = useState<Array<{ value: string; label: string }>>(
    []
  );
  const [kpis, setKpis] = useState<OpsKpisPayload | null>(null);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const [trend, setTrend] = useState<OpsTrendPayload | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const cacheRef = useRef<Record<string, OpsKpisPayload>>({});
  const trendCacheRef = useRef<Record<string, OpsTrendPayload>>({});
  const reduceMotion = usePrefersReducedMotion();

  const permissions = userProfile?.permissions ?? [];
  const canSeeMisKpis = hasAnyMisAccess(permissions);
  const cacheKey = useMemo(
    () => dashboardCacheKey(period, selectedCallTypes),
    [period, selectedCallTypes]
  );

  useEffect(() => {
    if (!userProfile || !canSeeMisKpis) return;

    const cached = cacheRef.current[cacheKey];
    const cachedTrend = trendCacheRef.current[cacheKey];
    if (cached) {
      setKpis(cached);
      setKpisLoading(false);
      setKpisError(null);
    }
    if (cachedTrend) {
      setTrend(cachedTrend);
      setTrendLoading(false);
    }
    if (cached && cachedTrend) return;

    let cancelled = false;
    if (!cached) {
      setKpisLoading(true);
      setKpisError(null);
    }
    if (!cachedTrend) setTrendLoading(true);

    void (async () => {
      try {
        const kpiUrl = appendCallTypesParam(
          `/api/report/ops-kpis?period=${period}`,
          selectedCallTypes
        );
        const trendUrl = appendCallTypesParam(
          `/api/report/ops-kpis/trend?period=${period}`,
          selectedCallTypes
        );
        const [kpiRes, trendRes] = await Promise.all([
          cached ? null : fetch(kpiUrl, { credentials: 'include' }),
          cachedTrend ? null : fetch(trendUrl, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (kpiRes) {
          const payload = await kpiRes.json().catch(() => ({}));
          if (!kpiRes.ok) {
            setKpisError(
              typeof payload.error === 'string' ? payload.error : 'Could not load ops summary'
            );
          } else {
            const next = payload as OpsKpisPayload;
            cacheRef.current[cacheKey] = next;
            setKpis(next);
            // Seed filter options from unfiltered (or merge) call-type mix.
            if (Array.isArray(next.callTypes) && next.callTypes.length > 0) {
              setCallTypeOptions((prev) => {
                const map = new Map(prev.map((o) => [o.value, o]));
                for (const row of next.callTypes) {
                  const value = String(row.call_type || 'UNKNOWN').toUpperCase();
                  if (!map.has(value)) map.set(value, { value, label: value });
                }
                return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
              });
            }
          }
        }

        if (trendRes) {
          const payload = await trendRes.json().catch(() => ({}));
          if (trendRes.ok) {
            const next: OpsTrendPayload = {
              days: Array.isArray(payload.days) ? payload.days : [],
              callTypes: Array.isArray(payload.callTypes) ? payload.callTypes : [],
              topTypes: Array.isArray(payload.topTypes) ? payload.topTypes : [],
            };
            trendCacheRef.current[cacheKey] = next;
            setTrend(next);
            if (next.topTypes.length > 0) {
              setCallTypeOptions((prev) => {
                const map = new Map(prev.map((o) => [o.value, o]));
                for (const t of next.topTypes) {
                  const value = String(t).toUpperCase();
                  if (!map.has(value)) map.set(value, { value, label: value });
                }
                return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
              });
            }
          } else if (!cancelled) {
            setTrend({ days: [], callTypes: [], topTypes: [] });
          }
        }
      } catch {
        if (!cancelled) {
          if (!cached) setKpisError('Could not load ops summary');
          if (!cachedTrend) setTrend({ days: [], callTypes: [], topTypes: [] });
        }
      } finally {
        if (!cancelled) {
          setKpisLoading(false);
          setTrendLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userProfile, canSeeMisKpis, period, selectedCallTypes, cacheKey]);

  const greeting = greetingForHour(new Date().getHours());

  if (loadingProfile || !userProfile) {
    return <PageLoadingState label="Loading dashboard…" />;
  }

  const solvedRate = kpis ? closeRatePct(kpis.solved_calls, kpis.total_calls) : 0;
  const periodMeta = PERIOD_OPTIONS.find((o) => o.id === period) ?? PERIOD_OPTIONS[0];
  const periodSubtitle = periodMeta.label;
  const isUpdating = Boolean(kpisLoading && kpis);
  const periodRangeLabel = kpis
    ? formatPeriodLabel(period, kpis.startDate, kpis.endDate)
    : 'Your assigned branches';
  const headerSubtitle = isUpdating
    ? `Refreshing · ${periodSubtitle.toLowerCase()}`
    : periodRangeLabel;

  return (
    <PageShell
      title={`${greeting}, ${firstName(userProfile.name)}`}
      subtitle={headerSubtitle}
      icon={<LayoutDashboard size={16} />}
      actions={
        canSeeMisKpis ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilterSelect
              label="Call type"
              emptyLabel="All call types"
              layout="inline"
              mode="multi"
              showSelectAll
              options={callTypeOptions}
              selected={selectedCallTypes}
              onChange={setSelectedCallTypes}
              panelClassName="w-64"
            />
            <PeriodToggle
              period={period}
              onChange={setPeriod}
              disabled={isUpdating}
              reduceMotion={reduceMotion}
            />
          </div>
        ) : null
      }
      bodyClassName="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden bg-bg-soft"
    >
      <PageScrollRegion className="p-4 md:p-6">
        <div className="mx-auto flex w-full min-w-0 max-w-[1400px] flex-col gap-4">
          {!canSeeMisKpis ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-bg-canvas px-4 py-8 text-center text-[13px] text-slate-500 dark:border-slate-800">
              No MIS overview for this account. Ask an admin to grant MIS Reports access.
            </div>
          ) : kpisLoading && !kpis ? (
            <div className="flex flex-col gap-4">
              <div className="h-[88px] animate-pulse rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800" />
              <div className="grid gap-4 lg:grid-cols-5">
                <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-bg-canvas lg:col-span-3 dark:border-slate-800" />
                <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-bg-canvas lg:col-span-2 dark:border-slate-800" />
              </div>
              <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800" />
            </div>
          ) : kpisError && !kpis ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-bg-canvas px-4 py-5 text-[13px] text-slate-500 dark:border-slate-800">
              {kpisError}
            </div>
          ) : kpis ? (
            <motion.div
              key={`${period}-${kpis.startDate}-${kpis.endDate}`}
              className={`flex flex-col gap-4 transition-opacity duration-200 ease-out ${
                isUpdating ? 'pointer-events-none opacity-50' : 'opacity-100'
              }`}
              initial={reduceMotion ? false : 'hidden'}
              animate="show"
              variants={reduceMotion ? undefined : staggerContainer}
              aria-busy={isUpdating}
            >
              <DashboardStatsStrip
                reduceMotion={reduceMotion}
                stats={{
                  total_calls: kpis.total_calls,
                  open_calls: kpis.open_calls,
                  open_unallocated: kpis.open_unallocated,
                  assigned: kpis.assigned,
                  solved_calls: kpis.solved_calls,
                  tech_solved: kpis.tech_solved,
                  cancelled_calls: kpis.cancelled_calls,
                }}
              />

              <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-5 lg:items-start">
                <div className="h-fit min-w-0 lg:col-span-3">
                  <OpsStatusTrendChart
                    days={trend?.days ?? []}
                    portfolioCallTypes={kpis.callTypes ?? []}
                    loading={trendLoading}
                  />
                </div>
                <div className="h-fit min-w-0 lg:col-span-2">
                  <DashboardAgingPanel
                    reduceMotion={reduceMotion}
                    stats={{
                      age_2: kpis.age_2,
                      age_3: kpis.age_3,
                      age_7: kpis.age_7,
                      age_15: kpis.age_15,
                    }}
                  />
                </div>
              </div>

              <OverviewTable
                title="Region overview"
                subtitle="Open high → low"
                reduceMotion={reduceMotion}
                columns={[
                  { key: 'region', label: 'Region' },
                  { key: 'total', label: 'Total', align: 'right' },
                  { key: 'solved', label: 'Solved', align: 'right' },
                  { key: 'cancelled', label: 'Cancel', align: 'right' },
                  { key: 'open', label: 'Open', align: 'right' },
                  { key: 'unalloc', label: 'Unalloc', align: 'right' },
                  { key: 'pct', label: 'Solved %', align: 'right' },
                ]}
                empty={kpis.regions.length === 0}
                rows={kpis.regions.map((row) => (
                  <tr
                    key={row.region}
                    className="border-t border-slate-100 text-slate-800 transition-colors hover:bg-bg-soft/80 dark:border-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-900/50"
                  >
                    <td className="px-2.5 py-2 font-semibold">{row.region}</td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={row.total_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      <Num value={row.solved_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right text-rose-700 dark:text-rose-400">
                      <Num value={row.cancelled_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right font-semibold">
                      <Num value={row.open_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={row.open_unallocated} />
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {closeRatePct(row.solved_calls, row.total_calls)}%
                    </td>
                  </tr>
                ))}
                footer={
                  <tr className="border-t border-slate-200 bg-bg-soft font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-white">
                    <td className="px-2.5 py-2">Total</td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={kpis.total_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={kpis.solved_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={kpis.cancelled_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={kpis.open_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={kpis.open_unallocated} />
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{solvedRate}%</td>
                  </tr>
                }
              />

              <OverviewTable
                title="Top open branches"
                subtitle="Highest open · top 10"
                reduceMotion={reduceMotion}
                columns={[
                  { key: 'branch', label: 'Branch' },
                  { key: 'open', label: 'Open', align: 'right' },
                  { key: 'unalloc', label: 'Unalloc', align: 'right' },
                  { key: 'total', label: 'Total', align: 'right' },
                  { key: 'pct', label: 'Solved %', align: 'right' },
                ]}
                empty={(kpis.topBranches ?? []).length === 0}
                rows={(kpis.topBranches ?? []).map((row) => (
                  <tr
                    key={`${row.region}-${row.branch}`}
                    className="border-t border-slate-100 text-slate-800 transition-colors hover:bg-bg-soft/80 dark:border-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-900/50"
                  >
                    <td className="truncate px-2.5 py-2 font-semibold" title={row.branch}>
                      {row.branch}
                    </td>
                    <td className="px-2.5 py-2 text-right font-semibold">
                      <Num value={row.open_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={row.open_unallocated} />
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <Num value={row.total_calls} />
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {closeRatePct(row.solved_calls, row.total_calls)}%
                    </td>
                  </tr>
                ))}
              />
            </motion.div>
          ) : null}
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
