'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  collapseSpring,
  instantTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

type CollapseProps = {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  onExitComplete?: () => void;
};

export function Collapse({ open, children, className = '', onExitComplete }: CollapseProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <AnimatePresence initial={false} onExitComplete={onExitComplete}>
      {open ? (
        <motion.div
          key="collapse"
          className={className}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reducedMotion ? instantTransition() : collapseSpring}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
