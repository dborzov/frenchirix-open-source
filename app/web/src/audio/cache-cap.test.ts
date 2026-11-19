import { describe, expect, it } from 'vitest';
import { cacheCapBytes } from './engine';

const MB = 1024 * 1024;
describe('audio cache cap', () => {
  it('keeps less decoded audio on small devices', () => {
    expect(cacheCapBytes({ deviceMemory: 2 })).toBe(32 * MB);
    expect(cacheCapBytes({ deviceMemory: 8, width: 390, height: 844 })).toBe(96 * MB);
    expect(cacheCapBytes({ width: 390, height: 844 })).toBe(32 * MB); // iPhone: no deviceMemory
    expect(cacheCapBytes({ width: 1024, height: 1366 })).toBe(96 * MB); // iPad
    expect(cacheCapBytes({})).toBe(96 * MB);
  });
});
