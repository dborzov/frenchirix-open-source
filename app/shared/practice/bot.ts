// The bots that prove a practice can be finished, through the puzzle types' real reducers.
//
// The perfect bot loops solve -> reduce until isDone: every puzzle must finish within a step limit
// with no mistakes and nothing missed. The clumsy bot makes wrong moves first, through the optional
// `wrongAction` a puzzle type may expose (BotHooks below; not part of the PuzzleType contract), and must still
// finish: a wrong move must count a mistake and never end or block the puzzle. A puzzle type without
// `wrongAction` is played by the clumsy bot like the perfect one, minus the zero-mistake rule.
// Both bots also check that reduce is pure (it must not mutate the state it is given).

import type { Scene } from '../content';
import '../puzzles/index';
import { allPuzzleTypes } from './registry';
import { createRng, type Rng } from './rng';
import type { AnyPuzzleType, Practice, PuzzleBase } from './types';
import { toSceneMap, type Problem } from './validate';

/** Optional extra a puzzle type logic may carry so the clumsy bot can test wrong moves. */
export interface BotHooks<T extends PuzzleBase = PuzzleBase, S = unknown, A = unknown> {
  /**
   * An action a kid could make that is wrong in this state, or null when no wrong move exists now.
   * Reducing it must count a mistake and must not finish the puzzle.
   */
  wrongAction?(puzzle: T, state: S, rng: Rng): A | null;
}

export type BotMode = 'perfect' | 'clumsy';

export interface PlayOptions {
  mode?: BotMode;
  seed?: number; // for the clumsy bot's choices
  maxSteps?: number;
  puzzleTypes?: AnyPuzzleType[];
  /** Called on every step, for --verbose replays. */
  trace?: (puzzle: PuzzleBase, step: number, action: unknown, wrong: boolean) => void;
}

export const BOT_MAX_STEPS = 300;
/** The clumsy bot makes this many wrong moves at the start of a puzzle, then one with this chance per step. */
export const CLUMSY_OPENING_MISTAKES = 2;
export const CLUMSY_MISTAKE_CHANCE = 0.4;

export interface PuzzleRun {
  steps: number;
  mistakes: number;
  wrongMoves: number;
  hasWrongAction: boolean;
}

function snapshot(state: unknown): string | null {
  try {
    return JSON.stringify(state, (_k, v) =>
      v instanceof Set ? { $set: [...v] } : v instanceof Map ? { $map: [...v] } : v,
    );
  } catch {
    return null;
  }
}

/** Plays one puzzle. Returns the problems found and what happened. */
export function playPuzzle(
  puzzle: PuzzleBase,
  puzzleType: AnyPuzzleType,
  opts: PlayOptions = {},
): { problems: string[]; run: PuzzleRun } {
  const mode = opts.mode ?? 'perfect';
  const maxSteps = opts.maxSteps ?? BOT_MAX_STEPS;
  const rng = createRng(opts.seed ?? 1).fork(`bot:${puzzle.id}`);
  const hooks = puzzleType as AnyPuzzleType & BotHooks<any, any, any>;
  const hasWrong = typeof hooks.wrongAction === 'function';
  const problems: string[] = [];
  const run: PuzzleRun = { steps: 0, mistakes: 0, wrongMoves: 0, hasWrongAction: hasWrong };

  let state: unknown;
  try {
    state = puzzleType.init(puzzle);
  } catch (err) {
    problems.push(`init threw: ${(err as Error).message}`);
    return { problems, run };
  }
  const safe = <R>(what: string, f: () => R): R | undefined => {
    try {
      return f();
    } catch (err) {
      problems.push(`${what} threw: ${(err as Error).message}`);
      return undefined;
    }
  };
  if (safe('isDone', () => puzzleType.isDone(puzzle, state))) {
    problems.push('the puzzle is finished before the kid does anything');
    return { problems, run };
  }

  const step = (action: unknown, wrong: boolean): boolean => {
    const before = snapshot(state);
    const mistakesBefore = puzzleType.mistakes(puzzle, state);
    const next = safe('reduce', () => puzzleType.reduce(puzzle, state, action));
    if (next === undefined) return false;
    if (before !== null && snapshot(state) !== before) {
      problems.push(`reduce mutated the state it was given (step ${run.steps + 1}); it must be pure`);
      return false;
    }
    state = next;
    run.steps++;
    opts.trace?.(puzzle, run.steps, action, wrong);
    if (wrong) {
      run.wrongMoves++;
      if (puzzleType.isDone(puzzle, state)) {
        problems.push(`a wrong move finished the puzzle (step ${run.steps}, action ${JSON.stringify(action)})`);
        return false;
      }
      if (puzzleType.mistakes(puzzle, state) <= mistakesBefore)
        problems.push(`a wrong move did not count a mistake (step ${run.steps}, action ${JSON.stringify(action)})`);
    }
    return true;
  };

  let opening = mode === 'clumsy' && hasWrong ? CLUMSY_OPENING_MISTAKES : 0;
  while (run.steps < maxSteps) {
    if (puzzleType.isDone(puzzle, state)) break;
    if (mode === 'clumsy' && hasWrong && (opening > 0 || rng.next() < CLUMSY_MISTAKE_CHANCE)) {
      opening = Math.max(0, opening - 1);
      const wrong = safe('wrongAction', () => hooks.wrongAction!(puzzle, state, rng));
      if (problems.length) break;
      if (wrong !== null && wrong !== undefined) {
        if (!step(wrong, true)) break;
        continue;
      }
    }
    const action = safe('solve', () => puzzleType.solve(puzzle, state));
    if (problems.length) break;
    if (!step(action, false)) break;
  }

  if (problems.length === 0) {
    const done = safe('isDone', () => puzzleType.isDone(puzzle, state));
    if (!done) problems.push(`the puzzle did not finish within ${maxSteps} steps (${mode} bot)`);
  }
  run.mistakes = safe('mistakes', () => puzzleType.mistakes(puzzle, state)) ?? 0;
  if (problems.length === 0 && mode === 'perfect') {
    if (run.mistakes > 0) problems.push(`a perfect player ended with ${run.mistakes} mistakes`);
    const missed = safe('missedUnitIds', () => puzzleType.missedUnitIds(puzzle, state)) ?? [];
    if (missed.length > 0) problems.push(`a perfect player ended with missed units: ${missed.join(', ')}`);
  }
  if (problems.length === 0 && mode === 'clumsy') {
    const missed = safe('missedUnitIds', () => puzzleType.missedUnitIds(puzzle, state)) ?? [];
    const known = new Set(puzzle.unitIds);
    const stray = missed.filter((id) => !known.has(id));
    if (stray.length) problems.push(`missedUnitIds names units the puzzle does not use: ${stray.join(', ')}`);
  }
  return { problems, run };
}

/** Plays every puzzle of a practice with one bot. Returns the problems, each with scene, puzzle and puzzle type. */
export function playPractice(
  practice: Practice,
  scenes: readonly Scene[] | ReadonlyMap<string, Scene>,
  opts: PlayOptions = {},
): Problem[] {
  const puzzleTypes = opts.puzzleTypes ?? allPuzzleTypes();
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  const sceneMap = toSceneMap(scenes);
  const out: Problem[] = [];
  // Replacements of microphone rounds (puzzle.alt) are played too: a kid who cannot speak plays them.
  for (const puzzle of [...practice.puzzles, ...practice.puzzles.flatMap((t) => (t.alt ? [t.alt] : []))]) {
    const puzzleType = byType.get(puzzle.type);
    const base = { sceneId: puzzle.sceneId, puzzleId: puzzle.id, type: puzzle.type };
    if (!puzzleType) {
      out.push({ ...base, message: `no puzzle type is registered for type "${puzzle.type}"` });
      continue;
    }
    if (!sceneMap.has(puzzle.sceneId)) {
      out.push({ ...base, message: `the puzzle's scene ${puzzle.sceneId} is not in the content` });
      continue;
    }
    const { problems } = playPuzzle(puzzle, puzzleType, { ...opts, seed: opts.seed ?? practice.seed });
    const bot = opts.mode ?? 'perfect';
    for (const m of problems) out.push({ ...base, message: `${bot} bot: ${m}` });
  }
  return out;
}
