'use client';

import React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import type { SortDir } from '@/lib/ui/table-sort';

/** Active chevron or muted up/down pair so sortable columns look clickable. */
export function SortIndicator({
  active = false,
  dir = 'asc',
}: {
  active?: boolean;
  dir?: SortDir;
}) {
  if (active) {
    return dir === 'asc' ? (
      <ChevronUp size={12} className="table-sort-icon table-sort-icon--active shrink-0" aria-hidden />
    ) : (
      <ChevronDown size={12} className="table-sort-icon table-sort-icon--active shrink-0" aria-hidden />
    );
  }
  return (
    <ChevronsUpDown size={12} className="table-sort-icon table-sort-icon--idle shrink-0" aria-hidden />
  );
}

type SortableThProps = {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  /** When false, renders a plain th (no click / chevron). Default true. */
  sortable?: boolean;
  title?: string;
};

export function SortableTh({
  children,
  className = '',
  align = 'left',
  active = false,
  dir = 'asc',
  onClick,
  sortable = true,
  title,
}: SortableThProps) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

  if (!sortable) {
    return (
      <th className={`ui-field-label text-slate-600 ${alignClass} ${className}`.trim()} title={title}>
        {children}
      </th>
    );
  }

  const activeClass = active ? 'table-th-sortable--active' : '';

  return (
    <th
      className={`table-th-sortable ui-field-label text-slate-600 ${alignClass} ${activeClass} ${className}`.trim()}
      onClick={onClick}
      title={title ?? 'Click to sort'}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <div className={`flex items-center gap-1 ${justify}`}>
        <span>{children}</span>
        <SortIndicator active={active} dir={dir} />
      </div>
    </th>
  );
}
