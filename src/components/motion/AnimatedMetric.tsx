'use client';

import React, { useEffect, useState } from 'react';
import { useMotionValueEvent, useSpring } from 'motion/react';
import { metricSpring, usePrefersReducedMotion } from '@/lib/motion/presets';

type AnimatedMetricProps = {
  value: number;
  className?: string;
  format?: (value: number) => string;
  /** When false, the spring value is not rounded before formatting (for currency). */
  snapToInteger?: boolean;
};

export function AnimatedMetric({
  value,
  className = '',
  format = (n) => n.toLocaleString('en-IN'),
  snapToInteger = true,
}: AnimatedMetricProps) {
  const reducedMotion = usePrefersReducedMotion();
  const spring = useSpring(value, reducedMotion ? { stiffness: 1000, damping: 100 } : metricSpring);
  const [display, setDisplay] = useState(() => format(value));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useMotionValueEvent(spring, 'change', (latest) => {
    const v = snapToInteger ? Math.round(latest) : latest;
    setDisplay(format(v));
  });

  if (reducedMotion) {
    return <span className={className}>{format(value)}</span>;
  }

  return <span className={`${className} motion-metric`.trim()}>{display}</span>;
}
