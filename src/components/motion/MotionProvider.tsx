'use client';

import React from 'react';
import { LazyMotion, domAnimation } from 'motion/react';

type MotionProviderProps = {
  children: React.ReactNode;
};

export function MotionProvider({ children }: MotionProviderProps) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
