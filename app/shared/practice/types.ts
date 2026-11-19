// The practice and puzzle-type contract (docs/app-architecture.md, "The puzzle-type contract").
// Every puzzle type is a plug-in: pure logic in shared/puzzles/<type>.ts (a PuzzleType), a view in
// web/src/puzzles/<type>/ (a PuzzleView), both registered in web/src/puzzles/registry.ts.
// The same logic drives the screen, the bot and the practice checks, which is what proves a practice passable.

import type { ContentIndex, Scene } from '../content';
import type { Rng } from './rng';

export interface PuzzleBase {
  id: string; // unique in the practice
  type: string; // the puzzle type
  sceneId: string;
  helpLineIds: string[]; // lines shown in the help strip; must hold every piece of French the puzzle uses
  unitIds: string[]; // the units this puzzle exercises (for per-kid statistics)
  questionId?: string; // the scene question this puzzle shows, if any (the server spaces questions per kid)
  /**
   * For a microphone puzzle: the tapping puzzle on the same French that replaces it when the kid
   * cannot speak (shared/practice/replace.ts). Set by the composer; never itself a microphone puzzle.
   */
  alt?: PuzzleBase;
}

/**
 * Where a puzzle type sits in a practice; the composer sequences puzzles by role.
 * intro = watching the scene; recognise = picking or matching a meaning; recall = rebuilding French
 * (filling blanks, ordering); produce = speaking; fun = questions and arcade rounds.
 */
export type PuzzleRole = 'intro' | 'recognise' | 'recall' | 'produce' | 'fun';

export interface PuzzleTypeMeta {
  role: PuzzleRole;
  minLevel: number; // the levels it suits (1 = bronze ... 6 = plutonium)
  maxLevel: number;
  needsMic: boolean;
  seconds: number; // typical time to finish
  weight: number; // how often the composer picks it, relative to others
  /** A short English working name, unique, for talking about it ("Catapult", "Rebuild the line"). */
  name: string;
  /** One or two English sentences: what the kid does and what it reinforces. */
  purpose: string;
  depth: PuzzleDepth;
  /**
   * unit = one word or expression; line = one short dialogue line; long-line = a full, long line;
   * multi-line = meaning or order across 3-4 lines; scene = the whole scene.
   */
  scope: PuzzleScope;
}

export type PuzzleDepth = 'intro' | 'core' | 'advanced';
export type PuzzleScope = 'unit' | 'line' | 'long-line' | 'multi-line' | 'scene';

export interface PuzzleType<T extends PuzzleBase = PuzzleBase, S = unknown, A = unknown> {
  type: string;
  meta: PuzzleTypeMeta;
  /** A puzzle for this scene, or null when the scene cannot support one. */
  build(ctx: BuildCtx): T | null;
  init(puzzle: T): S;
  /** Pure. A wrong action changes state (counts a mistake) but never ends the puzzle in failure. */
  reduce(puzzle: T, state: S, action: A): S;
  isDone(puzzle: T, state: S): boolean;
  mistakes(puzzle: T, state: S): number;
  missedUnitIds(puzzle: T, state: S): string[];
  /** The next action of a perfect player; the bot loops solve + reduce until isDone. */
  solve(puzzle: T, state: S): A;
  /** Problems found; empty means fine. */
  validate(puzzle: T, scene: Scene): string[];
}

/** A PuzzleType with its type parameters erased, as stored in the registry. */
export type AnyPuzzleType = PuzzleType<any, any, any>;

export interface BuildCtx {
  scene: Scene;
  level: number; // the level the practice earns when passed (1 = bronze ... 6 = plutonium)
  rng: Rng;
  focusUnitIds: ReadonlySet<string>; // units this kid is weak on: prefer them
  others: Scene[]; // the other scenes of the practice, for distractors
  bank: ContentIndex['bank'];
  usedLineIds: Set<string>; // already used in this practice, to keep variety
  usedUnitIds: Set<string>;
  /** Question ids this kid may see in this practice; undefined = every question is allowed. */
  allowedQuestionIds?: ReadonlySet<string>;
  /** A targeted build (the replacement of a microphone round): use this line only, or return null. */
  targetLineId?: string;
  /** With targetLineId, for puzzle types that blank or ask for units: exactly these units of that line. */
  targetUnitIds?: readonly string[];
}

/** Informational only (the composer says 'practice'; test and dev practices 'scene'). */
export type PracticeKind = 'scene' | 'practice';

export interface PracticeEntry {
  sceneId: string;
  level: number; // the level the practice is played at (1 = bronze ... 6 = plutonium)
  due: boolean; // true when passing it can raise the scene's level (false for a replay)
}

export interface Practice {
  id: string;
  seed: number;
  kind: PracticeKind;
  entries: PracticeEntry[];
  puzzles: PuzzleBase[];
}

/**
 * What POST /api/practices/start answers: a practice on one scene at one level, played from start to
 * end with no breaks; the kid can leave after any puzzle and continue later. The client fetches the
 * scene and composes it with composePractice from `seed` (and `level`, `speak`,
 * `allowedQuestionIds`), to get the same puzzles the checks validated, and starts at
 * `resumeIndex(done, length, same)` (practice.ts): at puzzle `done`, but when contentVersion or
 * composerVersion differ from the client's (the puzzles may be others), no later than the last puzzle,
 * so a practice never finishes without a puzzle played.
 *
 * What the practice screen shows of where the kid is: `level` (the level the practice is for) or
 * `replay`, and puzzle `done + 1` of the composed length.
 */
export interface PracticePlan {
  id: string;
  seed: number;
  entries: PracticeEntry[];
  focusUnitIds: string[];
  speak: boolean; // false: no puzzle type with meta.needsMic
  allowedQuestionIds: string[]; // questions of the plan's scene the kid may see (rules.questionEligible)
  contentVersion?: string; // ContentIndex.version when the plan was made
  sceneId: string;
  /** The level it is played at: the level it earns when passed (1 bronze ... 6 plutonium); for a replay, the scene's level. */
  level: number;
  replay: boolean; // a replay: the scene's next level is not due; XP only, never changes a level
  done: number; // puzzles already finished (0 for a new practice)
  total: number | null; // puzzles in the practice as last reported by the client; null until the first progress save
  outcomes: PuzzleOutcome[]; // the outcomes saved so far
  composerVersion: number | null; // the client's composer version when the plan was made
}

export interface PuzzleOutcome {
  puzzleId: string;
  type: string;
  sceneId: string;
  unitIds: string[];
  missedUnitIds: string[];
  mistakes: number;
  hints: number; // times the help strip was opened where it starts closed
  skipped: boolean;
  ms: number;
  questionId?: string; // copied from the puzzle: the question shown, recorded by the server
}
