'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import {
  crossfadeTransition,
  instantTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

type DataTableLoadingProps = {
  loading?: boolean;
  updating?: boolean;
  /** Shown when loading with no content yet. */
  loadingLabel?: string;
  /** Shown above table when updating with existing content. */
  updatingLabel?: string;
  hasContent?: boolean;
  children: React.ReactNode;
  className?: string;
};

/**
 * Stale-while-revalidate wrapper: spinner when empty, keep children + overlay when updating.
 */
export function DataTableLoading({
  loading = false,
  updating = false,
  loadingLabel = 'Loading data…',
  updatingLabel = 'Updating…',
  hasContent = true,
  children,
  className = '',
}: DataTableLoadingProps) {
  const reducedMotion = usePrefersReducedMotion();
  const showInitial = loading && !hasContent;
  const transition = reducedMotion ? instantTransition() : crossfadeTransition();

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className}`.trim()}>
      <AnimatePresence mode="sync" initial={false}>
        {showInitial ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="flex flex-col items-center justify-center gap-2 py-10"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            <p className="text-[11px] text-slate-500">{loadingLabel}</p>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="flex min-h-0 flex-1 flex-col"
          >
            {updating ? (
              <p className="mb-2 text-[10px] text-slate-400" aria-live="polite">
                {updatingLabel}
              </p>
            ) : null}
            <div
              className={
                updating ? 'pointer-events-none opacity-60 transition-opacity duration-300 ease-out' : undefined
              }
            >
              {children}
            </div>
            {updating ? (
              <div className="report-loading-overlay rounded-lg" aria-hidden="true">
                <Loader2 className="h-5 w-5 animate-spin text-slate-600" />
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  className?: string;
};

/** Pulse skeleton rows for admin/report tables while first paint loads. */
export function TableSkeleton({ rows = 6, columns = 5, className = '' }: TableSkeletonProps) {
  return (
    <div className={`animate-pulse space-y-2 p-4 ${className}`.trim()} aria-busy="true" aria-live="polite">
      <div className="mb-3 h-8 rounded bg-slate-200/80" />
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-2">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <div
              key={colIndex}
              className="h-7 flex-1 rounded bg-slate-100"
              style={{ flex: colIndex === 0 ? 2 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

type FormSkeletonProps = {
  fields?: number;
  className?: string;
};

/** Profile/settings form placeholder. */
export function FormSkeleton({ fields = 4, className = '' }: FormSkeletonProps) {
  return (
    <div className={`animate-pulse space-y-6 p-6 ${className}`.trim()} aria-busy="true">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-slate-200" />
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-3 w-28 rounded bg-slate-100" />
        </div>
      </div>
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div className="h-3 w-24 rounded bg-slate-200" />
          <div className="h-9 w-full max-w-md rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
