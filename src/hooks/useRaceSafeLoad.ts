'use client';

import { useCallback, useRef } from 'react';

export type RaceSafeLoadHandle = {
  /** Start a new load; aborts any in-flight load from this hook instance. */
  run: (task: (ctx: RaceSafeLoadContext) => Promise<void>) => void;
  /** Abort the current load without starting a new one. */
  abort: () => void;
  /** True when `generation` no longer matches the active load. */
  isStale: (generation: number) => boolean;
  generationRef: React.MutableRefObject<number>;
};

export type RaceSafeLoadContext = {
  generation: number;
  signal: AbortSignal;
  isStale: () => boolean;
};

/**
 * Race-safe async loads: abort previous work, bump generation, guard state updates with isStale().
 */
export function useRaceSafeLoad(): RaceSafeLoadHandle {
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const isStale = useCallback((generation: number) => {
    return generation !== generationRef.current;
  }, []);

  const run = useCallback(
    (task: (ctx: RaceSafeLoadContext) => Promise<void>) => {
      abortRef.current?.abort();
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const controller = new AbortController();
      abortRef.current = controller;

      void task({
        generation,
        signal: controller.signal,
        isStale: () => generation !== generationRef.current || controller.signal.aborted,
      }).finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      });
    },
    []
  );

  return { run, abort, isStale, generationRef };
}
