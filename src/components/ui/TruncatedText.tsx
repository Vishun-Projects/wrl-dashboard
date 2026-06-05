'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export type TruncatedTextProps = {
  /** Verbatim stored value — shown as-is; never transformed. */
  text: string;
  className?: string;
  /** When false, title tooltip is omitted (e.g. short strings). */
  showTitle?: boolean;
};

/**
 * Layout-only truncation. Hover title always uses the raw `text` value.
 */
export function TruncatedText({ text, className, showTitle = true }: TruncatedTextProps) {
  const display = text ?? '';
  return (
    <span
      className={cn('block min-w-0 truncate', className)}
      title={showTitle && display ? display : undefined}
    >
      {display}
    </span>
  );
}
