// The practice validator: the checks every practice must pass whatever puzzle types it holds. It runs each
// puzzle's own `validate`, then the guarantees no puzzle type should have to remember, above all "the answers
// are on the page": every unit a puzzle uses belongs to a line in its help strip. See docs/checks.md.

import type { Scene } from '../content';
import '../puzzles/index';
import { allPuzzleTypes } from './registry';
import type { AnyPuzzleType, PuzzleRole, Practice, PuzzleBase } from './types';

export interface Problem {
  sceneId: string; // '' when the problem is about the whole practice
  puzzleId: string; // '' when the problem is not about one puzzle
  type: string; // the puzzle type, '' when not about one puzzle
  message: string;
}

export interface ValidateOptions {
  /** The plan's speak flag; when false, a puzzle type with meta.needsMic is a problem. */
  speak?: boolean;
  puzzleTypes?: AnyPuzzleType[];
}

type SceneLookup = readonly Scene[] | ReadonlyMap<string, Scene>;

/** True when some puzzle type other than an intro can serve this level and speak setting. */
export function hasNonIntroPuzzle(puzzleTypes: AnyPuzzleType[], level: number, speak: boolean): boolean {
  return puzzleTypes.some((g) => g.meta.role !== 'intro' && level >= g.meta.minLevel && level <= g.meta.maxLevel && !(g.meta.needsMic && !speak));
}

export function toSceneMap(scenes: SceneLookup): ReadonlyMap<string, Scene> {
  return scenes instanceof Map ? scenes : new Map((scenes as readonly Scene[]).map((s) => [s.id, s]));
}

export function validatePractice(practice: Practice, scenes: SceneLookup, opts: ValidateOptions = {}): Problem[] {
  const puzzleTypes = opts.puzzleTypes ?? allPuzzleTypes();
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  const sceneMap = toSceneMap(scenes);
  const problems: Problem[] = [];
  const add = (puzzle: PuzzleBase | null, message: string, sceneId = puzzle?.sceneId ?? '') =>
    problems.push({ sceneId, puzzleId: puzzle?.id ?? '', type: puzzle?.type ?? '', message });

  if (practice.entries.length === 0) add(null, 'the practice has no scenes');
  if (practice.puzzles.length === 0) add(null, 'the practice has no puzzles');

  const entryById = new Map(practice.entries.map((e) => [e.sceneId, e]));
  if (entryById.size !== practice.entries.length) add(null, 'a scene appears twice in the practice entries');
  for (const e of practice.entries) {
    if (!sceneMap.has(e.sceneId)) add(null, `scene ${e.sceneId} of the practice is not in the content`, e.sceneId);
  }

  // Microphone rounds carry their tapping replacement (puzzle.alt): it must exist, be on the same
  // scene, need no microphone, and pass every check a puzzle passes.
  for (const puzzle of practice.puzzles) {
    const puzzleType = byType.get(puzzle.type);
    if (puzzleType?.meta.needsMic && !puzzle.alt) add(puzzle, 'a microphone puzzle has no tapping replacement (alt)');
    if (puzzle.alt) {
      if (puzzle.alt.sceneId !== puzzle.sceneId) add(puzzle, `its replacement ${puzzle.alt.id} is on another scene`);
      if (byType.get(puzzle.alt.type)?.meta.needsMic) add(puzzle, `its replacement ${puzzle.alt.id} needs the microphone`);
      if (puzzle.alt.alt) add(puzzle, 'its replacement has a replacement');
    }
  }
  const allPuzzles = [...practice.puzzles, ...practice.puzzles.flatMap((t) => (t.alt ? [t.alt] : []))];

  const seenIds = new Set<string>();
  for (const puzzle of allPuzzles) {
    if (!puzzle.id) add(puzzle, 'the puzzle has no id');
    else if (seenIds.has(puzzle.id)) add(puzzle, `puzzle id ${puzzle.id} is used twice`);
    seenIds.add(puzzle.id);

    const puzzleType = byType.get(puzzle.type);
    if (!puzzleType) {
      add(puzzle, `no puzzle type is registered for type "${puzzle.type}"`);
      continue;
    }
    const entry = entryById.get(puzzle.sceneId);
    if (!entry) add(puzzle, `the puzzle's scene ${puzzle.sceneId} is not in the practice`);
    const scene = sceneMap.get(puzzle.sceneId);
    if (!scene) {
      add(puzzle, `the puzzle's scene ${puzzle.sceneId} is not in the content`);
      continue;
    }

    if (entry) {
      if (entry.level < puzzleType.meta.minLevel || entry.level > puzzleType.meta.maxLevel)
        add(puzzle, `puzzle type ${puzzleType.type} suits levels ${puzzleType.meta.minLevel}-${puzzleType.meta.maxLevel}, not ${entry.level}`);
    }
    if (opts.speak === false && puzzleType.meta.needsMic) add(puzzle, `puzzle type ${puzzleType.type} needs the microphone but speak is off`);

    // Ids exist in the scene, and every unit is on the help strip.
    const lineIds = new Set(scene.lines.map((l) => l.id));
    const unitLine = new Map<string, string>();
    for (const l of scene.lines) for (const u of l.units) unitLine.set(u.id, l.id);
    if (!Array.isArray(puzzle.helpLineIds) || puzzle.helpLineIds.length === 0)
      add(puzzle, 'the help strip is empty (helpLineIds)');
    const help = new Set(puzzle.helpLineIds ?? []);
    for (const id of puzzle.helpLineIds ?? []) if (!lineIds.has(id)) add(puzzle, `help line ${id} is not in the scene`);
    for (const id of puzzle.unitIds ?? []) {
      const line = unitLine.get(id);
      if (!line) add(puzzle, `unit ${id} is not in the scene`);
      else if (!help.has(line)) add(puzzle, `unit ${id} is used but its line ${line} is not on the help strip`);
    }

    let own: string[] = [];
    try {
      own = puzzleType.validate(puzzle, scene);
    } catch (err) {
      own = [`validate threw: ${(err as Error).message}`];
    }
    for (const m of own) add(puzzle, m);
  }

  // The composer's policy.
  const roleOf = (t: PuzzleBase): PuzzleRole | undefined => byType.get(t.type)?.meta.role;
  for (const e of practice.entries) {
    const own = practice.puzzles.filter((t) => t.sceneId === e.sceneId);
    if (e.level <= 1) {
      if (own.length === 0 || roleOf(own[0]!) !== 'intro')
        add(null, 'a new scene must start with its intro (watch) before its other puzzles', e.sceneId);
    }
    if (own.length === 0) add(null, `scene ${e.sceneId} has no puzzle in the practice`, e.sceneId);
    else if (opts.speak !== undefined && hasNonIntroPuzzle(puzzleTypes, e.level, opts.speak)) {
      const others = own.filter((t) => roleOf(t) !== 'intro').length;
      if (others === 0) add(null, `scene ${e.sceneId} has no puzzle besides watching`, e.sceneId);
    }
  }
  return problems;
}
