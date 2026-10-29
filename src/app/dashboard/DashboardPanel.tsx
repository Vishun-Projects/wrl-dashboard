'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  MOTION_DURATION,
  MOTION_EASE_OUT,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

const sectionIn = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.slow, ease: MOTION_EASE_OUT },
  },
};

/** Shared chrome for dashboard tables / trend — matches OverviewTable header. */
export function DashboardPanel({
  title,
  subtitle,
  actions,
  children,
  bodyClassName = '',
  className = '',
  reduceMotion,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  reduceMotion?: boolean;
}) {
  const prefersReduced = usePrefersReducedMotion();
  const quiet = reduceMotion ?? prefersReduced;

  return (
    <motion.section
      variants={quiet ? undefined : sectionIn}
      initial={quiet ? false : 'hidden'}
      animate="show"
      layout={!quiet}
      className={`h-fit min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas dark:border-slate-800 ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <h3 className="min-w-0 truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {subtitle ? <p className="text-[11px] text-slate-500">{subtitle}</p> : null}
          {actions}
        </div>
      </div>
      <div className={`h-auto ${bodyClassName}`.trim()}>{children}</div>
    </motion.section>
  );
}
