'use client';

import React from 'react';
import { cn } from '@/lib/cn';

type ModalBackdropProps = {
  onClick?: () => void;
  className?: string;
};

/** Full-viewport dim + blur (matches Call Detail dialog). */
export function ModalBackdrop({ onClick, className }: ModalBackdropProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200',
        className
      )}
      onClick={onClick}
      aria-hidden
    />
  );
}
