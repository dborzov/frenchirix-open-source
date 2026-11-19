import { describe, expect, it } from 'vitest';
import { createRng, hashString } from './rng';

const draw = (seed: number, n = 20) => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('createRng', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(42)).toEqual(draw(42));
  });

  it('gives different sequences for different seeds', () => {
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('is pinned to known values, so a change of algorithm is noticed', () => {
    const r = createRng(1);
    const xs = [r.next(), r.next(), r.next()].map((x) => Math.round(x * 1e6));
    expect(xs).toEqual([627074, 2736, 527447]); // mulberry32(1), the reference values
  });

  it('next() stays in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int(n) covers 0..n-1 and nothing else', () => {
    const r = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(() => r.int(0)).toThrow();
  });

  it('pick and shuffle are deterministic and shuffle keeps the elements', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s1 = createRng(5).shuffle(items);
    const s2 = createRng(5).shuffle(items);
    expect(s1).toEqual(s2);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(createRng(5).pick(items)).toBe(createRng(5).pick(items));
    expect(() => createRng(5).pick([])).toThrow();
  });

  it('fork depends on the seed and label, not on how much was drawn', () => {
    const a = createRng(100);
    const b = createRng(100);
    b.next();
    b.next();
    expect(a.fork('scene:x').next()).toBe(b.fork('scene:x').next());
    expect(a.fork('scene:x').next()).not.toBe(a.fork('scene:y').next());
  });
});

describe('hashString', () => {
  it('is stable', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
