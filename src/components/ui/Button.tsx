'use client';

import React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { instantTransition, tapScale, tapSpring, usePrefersReducedMotion } from '@/lib/motion/presets';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border border-slate-800 bg-slate-900 text-white hover:bg-slate-800 shadow-sm',
  secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:bg-slate-50',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-[11px] font-medium rounded-md gap-1.5',
  md: 'px-3 py-2 text-xs font-medium rounded-lg gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.button
      type={type}
      whileTap={reducedMotion || props.disabled ? undefined : tapScale}
      transition={reducedMotion ? instantTransition() : tapSpring}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
