'use client';

import React from 'react';
import { cn } from '@/lib/cn';

type ModalBackdropProps = {
  onClick?: () => void;
  className?: string;
  /** Softer dim (engineer popup, etc.) */
  soft?: boolean;
  /** Stronger dim (nested prompts inside modals) */
  strong?: boolean;
};

/** Full-viewport dim + blur (matches Call Detail dialog). */
export function ModalBackdrop({ onClick, className, soft, strong }: ModalBackdropProps) {
  return (
    <div
      className={cn(
        'modal-backdrop fixed inset-0 backdrop-blur-sm animate-in fade-in duration-200',
        soft && 'modal-backdrop--soft',
        strong && 'modal-backdrop--strong',
        className
      )}
      onClick={onClick}
      aria-hidden
    />
  );
}
