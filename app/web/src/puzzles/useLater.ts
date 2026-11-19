// Timers that die with the puzzle. A puzzle view that plays something a moment after a move (the
// stretch again after the last panel, the next line after a choice) must not play it over the next
// puzzle: a sound started by a view that is gone takes the one voice and silences the new puzzle
// (say-chain then waited forever for its model to end). `later(fn, ms)`, in setTimeout's order, is
// cleared on unmount; it returns the timer's handle, for clearTimeout.
import { useCallback, useEffect, useRef } from 'react';

export function useLater(): (fn: () => unknown, ms: number) => number {
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((h) => window.clearTimeout(h)), []);
  return useCallback((fn: () => unknown, ms: number) => {
    const h = window.setTimeout(fn, ms);
    timers.current.push(h);
    return h;
  }, []);
}
