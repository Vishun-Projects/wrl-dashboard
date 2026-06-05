'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type HorizontalScrollFadeProps = {
  children: React.ReactNode;
  className?: string;
  /** Classes on the scrollable element (e.g. register-table-wrap). */
  scrollClassName?: string;
  /** Which edges show fade when more content is off-screen. */
  edge?: 'right' | 'left' | 'both';
};

function canScroll(el: HTMLElement, edge: 'left' | 'right'): boolean {
  const { scrollLeft, clientWidth, scrollWidth } = el;
  if (scrollWidth <= clientWidth + 1) return false;
  if (edge === 'right') return scrollLeft + clientWidth < scrollWidth - 1;
  return scrollLeft > 1;
}

export function HorizontalScrollFade({
  children,
  className,
  scrollClassName,
  edge = 'right',
}: HorizontalScrollFadeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fadeRight, setFadeRight] = useState(false);
  const [fadeLeft, setFadeLeft] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFadeRight(
      (edge === 'right' || edge === 'both') && canScroll(el, 'right')
    );
    setFadeLeft((edge === 'left' || edge === 'both') && canScroll(el, 'left'));
  }, [edge]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update]);

  const showRight = edge === 'right' || edge === 'both';
  const showLeft = edge === 'left' || edge === 'both';
  const fillsFlex = Boolean(className?.includes('flex-1'));

  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0',
        fillsFlex && 'flex flex-col',
        className
      )}
    >
      <div
        ref={scrollRef}
        className={cn('min-h-0 w-full flex-1 overflow-auto', scrollClassName)}
      >
        {children}
      </div>
      {showRight && fadeRight ? (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-white to-transparent"
          aria-hidden
        />
      ) : null}
      {showLeft && fadeLeft ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-white to-transparent"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
