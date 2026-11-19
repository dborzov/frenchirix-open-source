import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLater } from './useLater';

describe('useLater', () => {
  afterEach(() => vi.useRealTimers());

  it('runs while the view is there, and never after it is gone', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const { result, unmount } = renderHook(() => useLater());
    result.current(() => seen.push('soon'), 100);
    result.current(() => seen.push('after the next puzzle started'), 500);
    vi.advanceTimersByTime(200);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['soon']);
  });
});
