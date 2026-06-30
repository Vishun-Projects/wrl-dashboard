'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import {
  fadeSlideIn,
  instantTransition,
  motionTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

export type PageAlertVariant = 'error' | 'warning' | 'info';

export type PageAlertProps = {
  variant: PageAlertVariant;
  message: string;
  onDismiss?: () => void;
  className?: string;
};

const styles: Record<
  PageAlertVariant,
  { box: string; text: string; icon: React.ComponentType<{ className?: string }> }
> = {
  error: {
    box: 'border-red-200 bg-red-50',
    text: 'text-red-700',
    icon: AlertCircle,
  },
  warning: {
    box: 'border-amber-200 bg-amber-50',
    text: 'text-amber-900',
    icon: AlertTriangle,
  },
  info: {
    box: 'border-slate-200 bg-bg-soft',
    text: 'text-slate-700',
    icon: Info,
  },
};

export function PageAlert({ variant, message, onDismiss, className = '' }: PageAlertProps) {
  const { box, text, icon: Icon } = styles[variant];
  const reducedMotion = usePrefersReducedMotion();

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={message}
        role="alert"
        variants={fadeSlideIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reducedMotion ? instantTransition() : motionTransition()}
        className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${box} ${className}`}
      >
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${text}`} aria-hidden />
        <p className={`min-w-0 flex-1 leading-snug ${text}`}>{message}</p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className={`shrink-0 rounded p-0.5 hover:bg-black/5 ${text}`}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
