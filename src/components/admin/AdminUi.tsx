'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import { SortIndicator } from '@/components/ui/SortableTh';
import {
  fadeSlideIn,
  instantTransition,
  motionTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

export function AdminToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  children,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="register-filter-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="register-search-field relative w-full max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            className="register-search-input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}

export function AdminStatPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 shadow-sm">
      <span className="ui-help">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

export function AdminTableCard({
  children,
  empty,
  isEmpty,
  scrollClassName,
}: {
  children: React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: boolean;
  scrollClassName?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
      {isEmpty ? (
        <motion.div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center"
          variants={fadeSlideIn}
          initial="initial"
          animate="animate"
          transition={reducedMotion ? instantTransition() : motionTransition()}
        >
          {empty ?? (
            <>
              <p className="text-sm font-medium text-slate-600">No records found</p>
              <p className="ui-micro">Try adjusting your search.</p>
            </>
          )}
        </motion.div>
      ) : (
        <div
          className={
            scrollClassName ??
            'min-h-0 flex-1 overflow-auto custom-scrollbar'
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function AdminTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table
      className={
        className ?? 'w-full min-w-[720px] border-collapse text-left'
      }
    >
      {children}
    </table>
  );
}

export function AdminThead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-bg-soft">
      {children}
    </thead>
  );
}

export function AdminTh({
  children,
  className = '',
  align = 'left',
  sortable = false,
  sortKey,
  sort,
  onSort,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  sortKey?: string;
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  onSort?: (key: string) => void;
  title?: string;
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const active = Boolean(sortable && sortKey && sort?.key === sortKey);
  const clickable = Boolean(sortable && sortKey && onSort);

  return (
    <th
      className={`ui-field-label px-4 py-2.5 font-semibold text-slate-600 ${alignClass} ${
        clickable ? 'table-th-sortable' : ''
      } ${className}`}
      onClick={
        clickable
          ? () => onSort!(sortKey!)
          : undefined
      }
      title={title ?? (clickable ? 'Click to sort' : undefined)}
      aria-sort={
        active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : clickable ? 'none' : undefined
      }
    >
      {clickable ? (
        <div className={`flex items-center gap-1 ${justify}`}>
          <span>{children}</span>
          <SortIndicator active={active} dir={active ? sort!.dir : 'asc'} />
        </div>
      ) : (
        children
      )}
    </th>
  );
}

export function AdminTr({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      className={`border-b border-slate-100 transition-colors hover:bg-bg-soft/80 ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function AdminTd({
  children,
  className = '',
  align = 'left',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td className={`px-4 py-3 align-middle text-[12px] text-slate-700 ${alignClass} ${className}`}>
      {children}
    </td>
  );
}

export function RoleBadge({ name, isHod }: { name: string; isHod?: boolean }) {
  return (
    <span
      className={`ui-chip inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold ${
        isHod
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 bg-bg-soft text-slate-600'
      }`}
    >
      {name}
    </span>
  );
}

export function ChipList({
  items,
  maxVisible = 2,
  emptyLabel = '—',
  variant = 'default',
}: {
  items: string[];
  maxVisible?: number;
  emptyLabel?: string;
  variant?: 'default' | 'indigo';
}) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return <span className="ui-help">{emptyLabel}</span>;
  }

  const chipClass =
    variant === 'indigo'
      ? 'border-indigo-100 bg-indigo-50 text-indigo-700'
      : 'border-slate-200 bg-bg-soft text-slate-600';

  if (expanded || items.length <= maxVisible) {
    return (
      <div className="flex max-w-[220px] flex-wrap gap-1">
        {items.map((item) => (
          <span
            key={item}
            title={item}
            className={`ui-chip max-w-[200px] truncate rounded border px-1.5 py-0.5 ${chipClass}`}
          >
            {item}
          </span>
        ))}
        {items.length > maxVisible && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="ui-chip font-semibold text-slate-500 hover:text-slate-800"
          >
            Less
          </button>
        )}
      </div>
    );
  }

  const visible = items.slice(0, maxVisible);
  const rest = items.length - maxVisible;

  return (
    <div className="flex max-w-[220px] flex-wrap items-center gap-1">
      {visible.map((item) => (
        <span
          key={item}
          title={item}
          className={`ui-chip max-w-[100px] truncate rounded border px-1.5 py-0.5 ${chipClass}`}
        >
          {item}
        </span>
      ))}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ui-chip rounded border border-slate-200 bg-bg-canvas px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-bg-soft"
      >
        +{rest} more
      </button>
    </div>
  );
}

export function AdminIconButton({
  onClick,
  title,
  children,
  variant = 'default',
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'amber' | 'danger';
}) {
  const variantClass =
    variant === 'amber'
      ? 'hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
      : variant === 'danger'
        ? 'hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
        : 'hover:border-slate-300 hover:bg-bg-soft hover:text-slate-900';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors ${variantClass}`}
    >
      {children}
    </button>
  );
}

export function SettingsLayout({
  tabs,
  activeTab,
  onTabChange,
  children,
  fluid = false,
}: {
  tabs: { id: string; label: string; icon: React.ReactNode }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
  fluid?: boolean;
}) {
  return (
    <div
      className={`flex h-full min-h-0 w-full flex-col gap-4 p-4 sm:p-6 ${
        fluid ? '' : 'mx-auto max-w-4xl'
      }`}
    >
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-bg-canvas p-1 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ui-label ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:bg-bg-soft hover:text-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="ui-section-title">{title}</h2>
        {description ? <p className="mt-0.5 ui-help">{description}</p> : null}
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-bg-soft/50 px-6 py-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="ui-field-label">{label}</label>
      {children}
    </div>
  );
}

export function settingsInputClass(disabled = false) {
  return `ui-body h-9 w-full rounded-md border border-slate-200 bg-bg-canvas px-3 outline-none transition-colors focus:border-slate-400 focus:ring-1 focus:ring-slate-200 ${
    disabled ? 'cursor-not-allowed bg-bg-soft text-slate-400' : ''
  }`;
}
