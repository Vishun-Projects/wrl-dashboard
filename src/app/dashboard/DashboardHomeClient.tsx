'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Hourglass,
  LayoutDashboard,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useUser } from '@/components/layout/DashboardLayout';
import { PageLoadingState, PageScrollRegion, PageShell } from '@/components/layout/PageShell';
import { AnimatedMetric } from '@/components/motion';
import { hasAnyMisAccess } from '@/lib/auth/rbac-catalog';
import {
  MOTION_DURATION,
  MOTION_EASE_OUT,
  instantTransition,
  tapScale,
  tapSpring,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.045, delayChildren: 0.04 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.normal, ease: MOTION_EASE_OUT },
  },
};

const sectionIn = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.slow, ease: MOTION_EASE_OUT },
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
  callTypes: Array<{ call_type: string; total_calls: number; open_calls: number }>;
};

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

type OpsPeriod = 'month' | 'year' | 'all';

const PERIOD_OPTIONS: Array<{ id: OpsPeriod; label: string }> = [
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

function formatPeriodLabel(
  period: OpsPeriod,
  startDate: string,
  endDate: string
): string {
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

function KpiTile({
  label,
  value,
  hint,
  tone = 'default',
  reduceMotion = false,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'open' | 'good' | 'warn' | 'bad';
  reduceMotion?: boolean;
}) {
  const toneClass =
    tone === 'open'
      ? 'text-slate-900 dark:text-white'
      : tone === 'good'
        ? 'text-emerald-700 dark:text-emerald-400'
        : tone === 'warn'
          ? 'text-amber-700 dark:text-amber-400'
          : tone === 'bad'
            ? 'text-rose-700 dark:text-rose-400'
            : 'text-slate-800 dark:text-slate-100';

  return (
    <motion.div
      variants={reduceMotion ? undefined : staggerItem}
      whileHover={reduceMotion ? undefined : { y: -2, borderColor: 'rgb(203 213 225)' }}
      whileTap={reduceMotion ? undefined : tapScale}
      transition={reduceMotion ? instantTransition() : tapSpring}
      className="rounded-xl border border-slate-200 bg-bg-canvas p-3.5 dark:border-slate-800"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1.5 text-[1.55rem] font-semibold tabular-nums tracking-tight ${toneClass}`}>
        <AnimatedMetric value={value} />
      </p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </motion.div>
  );
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
    <motion.section
      variants={reduceMotion ? undefined : sectionIn}
      initial={reduceMotion ? false : 'hidden'}
      animate="show"
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h3 className="min-w-0 truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </h3>
        {subtitle ? (
          <p className="shrink-0 text-[11px] text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="overflow-x-hidden">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr className="bg-bg-soft text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-2.5 py-2.5 font-bold ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-slate-500"
                >
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
    </motion.section>
  );
}

export function DashboardHomeClient() {
  const { userProfile, loadingProfile } = useUser();
  const [period, setPeriod] = useState<OpsPeriod>('month');
  const [kpis, setKpis] = useState<OpsKpisPayload | null>(null);
  const [kpisLoading, setKpisLoading] = useState(false);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const cacheRef = useRef<Partial<Record<OpsPeriod, OpsKpisPayload>>>({});
  const reduceMotion = usePrefersReducedMotion();

  const permissions = userProfile?.permissions ?? [];
  const canSeeMisKpis = hasAnyMisAccess(permissions);

  useEffect(() => {
    if (!userProfile || !canSeeMisKpis) return;

    const cached = cacheRef.current[period];
    if (cached) {
      setKpis(cached);
      setKpisLoading(false);
      setKpisError(null);
      return;
    }

    let cancelled = false;
    setKpisLoading(true);
    setKpisError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/report/ops-kpis?period=${period}`, {
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setKpisError(
            typeof payload.error === 'string' ? payload.error : 'Could not load ops summary'
          );
          return;
        }
        const next = payload as OpsKpisPayload;
        cacheRef.current[period] = next;
        setKpis(next);
      } catch {
        if (!cancelled) setKpisError('Could not load ops summary');
      } finally {
        if (!cancelled) setKpisLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userProfile, canSeeMisKpis, period]);

  const greeting = greetingForHour(new Date().getHours());

  if (loadingProfile || !userProfile) {
    return <PageLoadingState label="Loading dashboard…" />;
  }

  const solvedRate = kpis ? closeRatePct(kpis.solved_calls, kpis.total_calls) : 0;
  const agingOver7 = kpis ? kpis.age_7 + kpis.age_15 : 0;
  const periodMeta = PERIOD_OPTIONS.find((o) => o.id === period) ?? PERIOD_OPTIONS[0];
  const periodSubtitle = periodMeta.label;
  const isUpdating = Boolean(kpisLoading && kpis);
  const periodRangeLabel = kpis
    ? formatPeriodLabel(period, kpis.startDate, kpis.endDate)
    : 'Your assigned branches';

  return (
    <PageShell
      title="Dashboard"
      subtitle={`${periodSubtitle} ops overview`}
      icon={<LayoutDashboard size={16} />}
      bodyClassName="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden bg-bg-soft"
    >
      <PageScrollRegion className="p-4 md:p-6">
        <div className="flex w-full min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.02em] text-slate-900 dark:text-white">
                {greeting}, {firstName(userProfile.name)}
              </h2>
              <div className="mt-1 flex min-h-[1.25rem] items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={isUpdating ? `pending-${period}` : periodRangeLabel}
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -3 }}
                    transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE_OUT }}
                  >
                    {isUpdating ? `Refreshing · ${periodSubtitle.toLowerCase()}` : periodRangeLabel}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>

            {canSeeMisKpis ? (
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
                      onClick={() => setPeriod(opt.id)}
                      aria-pressed={active}
                      disabled={isUpdating && active}
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
            ) : null}
          </div>

          {!canSeeMisKpis ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-bg-canvas px-4 py-8 text-center text-[13px] text-slate-500 dark:border-slate-800">
              No MIS overview for this account. Ask an admin to grant MIS Reports access.
            </div>
          ) : kpisLoading && !kpis ? (
            <div className="space-y-3">
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[92px] animate-pulse rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800"
                  />
                ))}
              </div>
              <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800" />
            </div>
          ) : kpisError && !kpis ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-bg-canvas px-4 py-5 text-[13px] text-slate-500 dark:border-slate-800">
              {kpisError}
            </div>
          ) : kpis ? (
            <motion.div
              key={`${period}-${kpis.startDate}-${kpis.endDate}`}
              className={`flex flex-col gap-5 transition-[opacity,filter] duration-200 ease-out ${
                isUpdating ? 'pointer-events-none opacity-50 saturate-50' : 'opacity-100'
              }`}
              initial={reduceMotion ? false : 'hidden'}
              animate="show"
              variants={reduceMotion ? undefined : staggerContainer}
              aria-busy={isUpdating}
            >
              <motion.section
                variants={reduceMotion ? undefined : staggerContainer}
                className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
              >
                <KpiTile
                  label="Total calls"
                  value={kpis.total_calls}
                  hint={`${solvedRate}% solved`}
                  reduceMotion={reduceMotion}
                />
                <KpiTile
                  label="Open"
                  value={kpis.open_calls}
                  tone="open"
                  hint={`${kpis.open_unallocated} unalloc · ${kpis.assigned} assigned`}
                  reduceMotion={reduceMotion}
                />
                <KpiTile
                  label="Unallocated"
                  value={kpis.open_unallocated}
                  tone={kpis.open_unallocated > 0 ? 'warn' : 'default'}
                  reduceMotion={reduceMotion}
                />
                <KpiTile
                  label="Solved"
                  value={kpis.solved_calls}
                  tone="good"
                  reduceMotion={reduceMotion}
                />
                <KpiTile
                  label="Tech solved"
                  value={kpis.tech_solved}
                  hint="Awaiting closure"
                  reduceMotion={reduceMotion}
                />
                <KpiTile
                  label="Cancelled"
                  value={kpis.cancelled_calls}
                  tone="bad"
                  reduceMotion={reduceMotion}
                />
              </motion.section>

              <motion.section
                variants={reduceMotion ? undefined : staggerContainer}
                className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5"
              >
                {(
                  [
                    { label: 'Open ≤2 days', value: kpis.age_2, icon: CheckCircle2 },
                    { label: 'Open 3–7 days', value: kpis.age_3, icon: CircleDashed },
                    { label: 'Open 8–15 days', value: kpis.age_7, icon: Hourglass },
                    { label: 'Open >15 days', value: kpis.age_15, icon: Ban },
                    {
                      label: 'Aging >7 days',
                      value: agingOver7,
                      icon: Hourglass,
                    },
                  ] as const
                ).map((bucket) => (
                  <motion.div
                    key={bucket.label}
                    variants={reduceMotion ? undefined : staggerItem}
                    whileHover={
                      reduceMotion ? undefined : { y: -2, borderColor: 'rgb(203 213 225)' }
                    }
                    transition={reduceMotion ? instantTransition() : tapSpring}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-bg-canvas px-3.5 py-3 dark:border-slate-800"
                  >
                    <bucket.icon size={15} className="text-slate-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {bucket.label}
                      </p>
                      <p className="text-[1.1rem] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        <AnimatedMetric value={bucket.value} />
                      </p>
                    </div>
                  </motion.div>
                ))}
              </motion.section>

              <OverviewTable
                title="Region overview"
                subtitle="Open calls sorted high → low"
                reduceMotion={reduceMotion}
                columns={[
                  { key: 'region', label: 'Region' },
                  { key: 'total', label: 'Total', align: 'right' },
                  { key: 'solved', label: 'Solved', align: 'right' },
                  { key: 'cancelled', label: 'Cancelled', align: 'right' },
                  { key: 'open', label: 'Open', align: 'right' },
                  { key: 'unalloc', label: 'Unalloc', align: 'right' },
                  { key: 'a2', label: '≤2d', align: 'right' },
                  { key: 'a3', label: '3–7d', align: 'right' },
                  { key: 'a7', label: '8–15d', align: 'right' },
                  { key: 'a15', label: '>15d', align: 'right' },
                  { key: 'pct', label: 'Solved %', align: 'right' },
                ]}
                empty={kpis.regions.length === 0}
                rows={kpis.regions.map((row) => (
                  <tr
                    key={row.region}
                    className="border-t border-slate-100 text-slate-800 transition-colors hover:bg-bg-soft/80 dark:border-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-900/50"
                  >
                    <td className="px-3 py-2 font-semibold">{row.region}</td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.total_calls} />
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">
                      <Num value={row.solved_calls} />
                    </td>
                    <td className="px-3 py-2 text-right text-rose-700 dark:text-rose-400">
                      <Num value={row.cancelled_calls} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      <Num value={row.open_calls} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.open_unallocated} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.age_2} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.age_3} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.age_7} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num value={row.age_15} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {closeRatePct(row.solved_calls, row.total_calls)}%
                    </td>
                  </tr>
                ))}
                footer={
                  <tr className="border-t border-slate-200 bg-bg-soft font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-white">
                    <td className="px-3 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.total_calls} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.solved_calls} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.cancelled_calls} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.open_calls} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.open_unallocated} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.age_2} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.age_3} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.age_7} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num value={kpis.age_15} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{solvedRate}%</td>
                  </tr>
                }
              />

              <motion.div
                variants={reduceMotion ? undefined : sectionIn}
                className="grid min-w-0 gap-5 lg:grid-cols-2"
              >
                <OverviewTable
                  title="Top open branches"
                  subtitle="Highest open count · top 10"
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

                <OverviewTable
                  title="Call type mix"
                  subtitle={`Top types · ${periodSubtitle.toLowerCase()}`}
                  reduceMotion={reduceMotion}
                  columns={[
                    { key: 'type', label: 'Call type' },
                    { key: 'total', label: 'Total', align: 'right' },
                    { key: 'open', label: 'Open', align: 'right' },
                    { key: 'share', label: 'Share', align: 'right' },
                  ]}
                  empty={(kpis.callTypes ?? []).length === 0}
                  rows={(kpis.callTypes ?? []).map((row) => {
                    const share =
                      kpis.total_calls > 0
                        ? Math.round((row.total_calls / kpis.total_calls) * 1000) / 10
                        : 0;
                    return (
                      <tr
                        key={row.call_type}
                        className="border-t border-slate-100 text-slate-800 transition-colors hover:bg-bg-soft/80 dark:border-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-900/50"
                      >
                        <td className="truncate px-2.5 py-2 font-semibold" title={row.call_type}>
                          {row.call_type}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Num value={row.total_calls} />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          <Num value={row.open_calls} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {share}%
                        </td>
                      </tr>
                    );
                  })}
                />
              </motion.div>
            </motion.div>
          ) : null}
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
