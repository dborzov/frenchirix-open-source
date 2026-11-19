// Small fake puzzle types for the composer, validator and bot tests. Not used by the app.

import type { Scene } from '../content';
import type { BotHooks } from './bot';
import type { AnyPuzzleType, PuzzleType, PuzzleTypeMeta, PuzzleRole, PuzzleBase } from './types';

export interface FakePuzzle extends PuzzleBase {
  items: string[]; // unit ids to answer, in order
}
export interface FakeState {
  next: number;
  mistakes: number;
  missed: string[];
}
export type FakeAction = { pick: string };

export interface FakeOptions extends Partial<PuzzleTypeMeta> {
  /** Return null for these scene ids (or for every scene when true). */
  nullFor?: true | string[];
  /** How many key units a puzzle uses. */
  items?: number;
}

/** A fake puzzle type: answer each of its units in order; a wrong pick counts a mistake. */
export function fakePuzzleType(type: string, role: PuzzleRole, opts: FakeOptions = {}): AnyPuzzleType {
  const meta: PuzzleTypeMeta = {
    role,
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 20,
    weight: 1,
    name: `Fake ${type}`,
    purpose: 'A fake puzzle type for tests.',
    depth: 'core',
    scope: role === 'intro' ? 'scene' : (opts.items ?? 1) > 1 ? 'unit' : 'line',
    ...opts,
  };
  const logic: PuzzleType<FakePuzzle, FakeState, FakeAction> & BotHooks<FakePuzzle, FakeState, FakeAction> = {
    type,
    meta,
    build(ctx) {
      if (opts.nullFor === true || (opts.nullFor && opts.nullFor.includes(ctx.scene.id))) return null;
      const units = ctx.scene.lines.flatMap((l) => l.units.filter((u) => u.key).map((u) => ({ u, l })));
      if (units.length === 0) return null;
      const preferred = units.filter(({ u }) => ctx.focusUnitIds.has(u.id));
      const fresh = units.filter(({ l }) => !ctx.usedLineIds.has(l.id));
      const pool = preferred.length ? preferred : fresh.length ? fresh : units;
      const chosen = ctx.rng.shuffle(pool).slice(0, opts.items ?? 1);
      return {
        id: `${ctx.scene.id}:${type}`,
        type,
        sceneId: ctx.scene.id,
        helpLineIds: [...new Set(chosen.map(({ l }) => l.id))],
        unitIds: chosen.map(({ u }) => u.id),
        items: chosen.map(({ u }) => u.id),
      };
    },
    init: () => ({ next: 0, mistakes: 0, missed: [] }),
    reduce(puzzle, s, a) {
      const want = puzzle.items[s.next];
      if (a.pick === want) return { ...s, next: s.next + 1 };
      return { ...s, mistakes: s.mistakes + 1, missed: want && !s.missed.includes(want) ? [...s.missed, want] : s.missed };
    },
    isDone: (puzzle, s) => s.next >= puzzle.items.length,
    mistakes: (_t, s) => s.mistakes,
    missedUnitIds: (_t, s) => s.missed,
    solve: (puzzle, s) => ({ pick: puzzle.items[s.next]! }),
    validate: (puzzle: FakePuzzle, _scene: Scene) => (puzzle.items.length ? [] : ['no items']),
    wrongAction: () => ({ pick: 'nope' }),
  };
  return logic;
}
