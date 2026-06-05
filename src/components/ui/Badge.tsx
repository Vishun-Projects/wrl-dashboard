'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import { statusSemantics } from '@/lib/ui/semantics';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeProps = {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  /** When true, uses compact Title Case label style instead of uppercase. */
  titleCase?: boolean;
};

const variantClasses: Record<BadgeVariant, string> = {
  neutral: statusSemantics.neutralBg,
  success: statusSemantics.successBg,
  warning: statusSemantics.warningBg,
  danger: statusSemantics.errorBg,
  info: statusSemantics.infoBg,
};

export function Badge({
  variant = 'neutral',
  children,
  className,
  titleCase = false,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold',
        titleCase ? 'tracking-normal' : 'font-bold uppercase tracking-wider',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
