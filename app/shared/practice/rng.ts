// A small seeded pseudo-random generator (mulberry32). Deterministic: the same seed gives the same
// sequence on every platform, which is what lets the server, the client and the practice checks
// compose the same practice from a PracticePlan seed.
//
// `fork(label)` derives an independent generator from this generator's *seed* and the label, not
// from its current position: forking 'scene:s01e04-0016-0017' gives the same stream no matter how
// many numbers were drawn before. Use forks to keep one part of a practice stable when another changes.

export interface Rng {
  readonly seed: number;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). Throws when n < 1. */
  int(n: number): number;
  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy (Fisher-Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent generator determined by this seed and the label. */
  fork(label: string): Rng;
}

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fresh random seed (not deterministic; for the server when it makes a PracticePlan). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export function createRng(seed: number): Rng {
  const initial = seed >>> 0;
  let a = initial;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => {
    if (!(n >= 1)) throw new RangeError(`rng.int: n must be >= 1, got ${n}`);
    return Math.floor(next() * Math.floor(n));
  };

  return {
    seed: initial,
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('rng.pick: empty array');
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    fork(label: string): Rng {
      return createRng(hashString(`${initial}:${label}`));
    },
  };
}
