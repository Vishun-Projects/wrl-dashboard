'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  fadeSlideIn,
  instantTransition,
  motionTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

type FadePresenceProps = {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  mode?: 'wait' | 'sync' | 'popLayout';
};

export function FadePresence({
  show,
  children,
  className = '',
  mode = 'wait',
}: FadePresenceProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <AnimatePresence mode={mode} initial={false}>
      {show ? (
        <motion.div
          key="fade-presence"
          className={className}
          variants={fadeSlideIn}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={reducedMotion ? instantTransition() : motionTransition()}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
