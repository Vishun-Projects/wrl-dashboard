'use client';

import { useEffect, useState } from 'react';
import type { Transition, Variants } from 'motion/react';

/** Doherty: respond immediately, settle smoothly over ~300–400ms. */
export const MOTION_DURATION = {
  fast: 0.2,
  normal: 0.32,
  slow: 0.42,
  metric: 0.45,
} as const;

/** Strong ease-out — decelerates into rest (feels polished, not snappy). */
export const MOTION_EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Gentle ease for exits and crossfades. */
export const MOTION_EASE_IN_OUT = [0.45, 0.05, 0.55, 1] as const;

/** Soft numeric roll — visible movement without bounce. */
export const metricSpring = {
  stiffness: 55,
  damping: 14,
  mass: 1,
  restDelta: 0.25,
} as const;

/** Sibling repositioning in chip lists. */
export const layoutSpring: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.6,
};

/** Expand / collapse height. */
export const collapseSpring: Transition = {
  height: { type: 'spring', stiffness: 220, damping: 26, mass: 0.8 },
  opacity: { duration: MOTION_DURATION.fast, ease: MOTION_EASE_OUT },
};

export const fadeSlideIn: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.normal, ease: MOTION_EASE_OUT },
  },
  exit: {
    opacity: 0,
    y: -2,
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT },
  },
};

export const fadeSlideOut: Variants = {
  initial: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -2 },
};

/** Fade + slight slide — no scale pop. */
export const chipItem: Variants = {
  initial: { opacity: 0, x: -5 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: MOTION_DURATION.normal, ease: MOTION_EASE_OUT },
  },
  exit: {
    opacity: 0,
    x: -4,
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT },
  },
};

export const tapScale = { scale: 0.985 };

export const tapSpring: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 28,
  mass: 0.4,
};

export const chipLayoutTransition: Transition = {
  type: 'spring',
  stiffness: 450,
  damping: 34,
  mass: 0.8,
};

export function instantTransition(): Transition {
  return { duration: 0 };
}

export function motionTransition(duration: number = MOTION_DURATION.normal): Transition {
  return { duration, ease: MOTION_EASE_OUT };
}

export function crossfadeTransition(): Transition {
  return { duration: MOTION_DURATION.normal, ease: MOTION_EASE_IN_OUT };
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return reduced;
}
