'use client';

import React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';

export type RowActionLinkProps = {
  href: string;
  label: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
};

export function RowActionLink({ href, label, className, onClick }: RowActionLinkProps) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-slate-200 bg-bg-canvas px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-bg-soft',
        className
      )}
    >
      {label}
      <ExternalLink className="h-3 w-3 text-slate-400" aria-hidden />
    </Link>
  );
}
