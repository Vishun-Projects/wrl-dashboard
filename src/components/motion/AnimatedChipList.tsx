'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  chipItem,
  chipLayoutTransition,
  instantTransition,
  usePrefersReducedMotion,
} from '@/lib/motion/presets';

type AnimatedChipListProps = {
  children: React.ReactNode;
  className?: string;
};

export function AnimatedChipList({ children, className = '' }: AnimatedChipListProps) {
  const reducedMotion = usePrefersReducedMotion();
  const layoutTransition = reducedMotion ? instantTransition() : chipLayoutTransition;

  return (
    <div className={['contents', className].filter(Boolean).join(' ')}>
      <AnimatePresence initial={false}>
        {React.Children.map(children, (child) => {
          if (!React.isValidElement(child)) return child;
          const key = child.key;
          if (key == null) return child;
          return (
            <motion.span
              key={key}
              layout={!reducedMotion ? 'position' : false}
              variants={chipItem}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={layoutTransition}
              className="inline-flex"
            >
              {child}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
