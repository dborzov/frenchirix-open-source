// What the dev pages compose, from URL parameters, so that a table and the runner it opens always
// show the same puzzles:
//   scene=<id>[,<id>…]   the scenes (a practice uses the first)
//   (no type)             composePractice (a practice at `level`; a replay is the practice at the scene's level)
//   type=<type>[,<type>…] instead: these puzzle types, one puzzle each, on the first scene
//   level=1..6  seed=<n>  speak=0|1  puzzle=<n> (start at puzzle n, 0-based)
import type { PracticeCompleteResponse } from '../../../../shared/api';
import type { ContentIndex, Scene } from '../../../../shared/content';
import { composePractice, type PracticeReport } from '../../../../shared/practice/practice';
import { replaceMicPuzzle } from '../../../../shared/practice/replace';
import { createRng } from '../../../../shared/practice/rng';
import type { Practice, PuzzleBase, PuzzleOutcome } from '../../../../shared/practice/types';
import { practiceStars, type Level } from '../../../../shared/rules';
import { loadIndex, loadScene } from '../../api';
import { allPuzzleEntries } from '../../puzzles/registry';

export const PANONO = 's01e03-0023-0026';

export interface DevParams {
  scenes: string[];
  puzzleTypes: string[];
  level: number;
  seed: number;
  speak: boolean;
  puzzle: number;
  /** With puzzle type=: aim the built puzzles at this line / these units (ctx.targetLineId / targetUnitIds). */
  line?: string;
  units?: string[];
}

export function parseDev(search: string): DevParams {
  const q = new URLSearchParams(search);
  return {
    scenes: (q.get('scene') ?? q.get('scenes') ?? '').split(',').filter(Boolean),
    puzzleTypes: (q.get('type') ?? '').split(',').filter(Boolean),
    level: Math.max(1, Math.min(6, Number(q.get('level') ?? 1) || 1)),
    seed: Number(q.get('seed') ?? 1) || 1,
    speak: q.get('speak') !== '0',
    puzzle: Number(q.get('puzzle') ?? 0) || 0,
    ...(q.get('line') ? { line: q.get('line')! } : {}),
    ...(q.get('unit') ? { units: q.get('unit')!.split(',').filter(Boolean) } : {}),
  };
}

export function devQuery(p: Partial<DevParams>): string {
  const q = new URLSearchParams();
  if (p.scenes?.length) q.set('scene', p.scenes.join(','));
  if (p.puzzleTypes?.length) q.set('type', p.puzzleTypes.join(','));
  q.set('level', String(p.level ?? 1));
  q.set('seed', String(p.seed ?? 1));
  if (p.speak === false) q.set('speak', '0');
  if (p.puzzle) q.set('puzzle', String(p.puzzle));
  if (p.line) q.set('line', p.line);
  return q.toString();
}

export interface DevComposed {
  practice: Practice;
  scenes: Map<string, Scene>;
  report?: PracticeReport;
  problems: string[];
}

/** Compose what the parameters describe (throws with a readable message when it cannot). */
export async function composeDev(p: DevParams, indexIn?: ContentIndex): Promise<DevComposed> {
  const index = indexIn ?? (await loadIndex());
  if (!p.scenes.length) throw new Error('no scene given');
  const scenes = await Promise.all(p.scenes.map((id) => loadScene(id)));
  const first = scenes[0]!;
  const others = await Promise.all(index.scenes.filter((x) => !p.scenes.includes(x.id) && x.episode === first.episode).slice(0, 2).map((o) => loadScene(o.id)));
  const map = new Map<string, Scene>([...scenes, ...others].map((sc) => [sc.id, sc]));
  if (p.puzzleTypes.length) {
    const usedLineIds = new Set<string>();
    const usedUnitIds = new Set<string>();
    const puzzles: PuzzleBase[] = [];
    p.puzzleTypes.forEach((type, i) => {
      const entry = allPuzzleEntries().find((e) => e.logic.type === type);
      if (!entry) throw new Error(`no puzzle type "${type}" (registered: ${allPuzzleEntries().map((e) => e.logic.type).join(', ')})`);
      const ctx = {
        scene: first,
        level: p.level,
        rng: createRng(p.seed).fork(`${type}:${i}`),
        focusUnitIds: new Set<string>(),
        others,
        bank: index.bank,
        usedLineIds,
        usedUnitIds,
        ...(p.line ? { targetLineId: p.line } : {}),
        ...(p.units?.length ? { targetUnitIds: p.units } : {}),
      };
      const puzzle = entry.logic.build(ctx);
      if (!puzzle) throw new Error(`${type}.build returned null for ${first.id} at level ${p.level}`);
      const problems = entry.logic.validate(puzzle, first);
      if (problems.length) console.warn('[dev] validate:', problems);
      const placed: PuzzleBase = { ...puzzle, id: `${first.id}:t${i + 1}:${type}` };
      // Like the composer: a microphone round carries its tapping replacement.
      if (entry.logic.meta.needsMic) {
        const alt = replaceMicPuzzle(placed, first, { ...ctx, rng: createRng(p.seed).fork(`alt:${i}`) });
        if (alt) placed.alt = alt.puzzle;
      }
      puzzles.push(placed);
    });
    return { practice: { id: 'dev', seed: p.seed, kind: 'scene', entries: [{ sceneId: first.id, level: p.level, due: true }], puzzles }, scenes: map, problems: [] };
  }
  // A practice on the first scene at `level`: what the app plays.
  const input = { id: 'dev', seed: p.seed, scene: first, level: p.level, speak: p.speak, bank: index.bank, others };
  const c = composePractice(input);
  return { practice: c, scenes: map, report: c.plan, problems: c.problems };
}

/** A local stand-in for the server's answer, so the results screen can be looked at (nothing is posted). */
export function fakeComplete(practice: Practice, outcomes: PuzzleOutcome[]): PracticeCompleteResponse {
  const mistakes = outcomes.reduce((n, o) => n + o.mistakes, 0);
  const hints = outcomes.reduce((n, o) => n + o.hints, 0);
  return {
    patch: {},
    level: practice.entries[0]?.level ?? 1,
    replay: false,
    quest: null,
    stars: practiceStars(outcomes.length, mistakes, hints),
    rewards: { xp: 10 + outcomes.length * 2, sesterces: 5 },
    chest: null,
    levels: practice.entries.filter((e) => e.level <= 6).map((e) => ({ sceneId: e.sceneId, from: (e.level - 1) as Level, to: e.level as Level, dueDay: null })),
    replayed: [],
    achievements: [],
    achievementRewards: {},
    streak: { count: 4, extended: true, freezesUsed: 0, reset: false, full: false },
    rankUp: null,
  };
}

/** One row of a composed practice, for the tables. */
export interface DevRow {
  index: number; // 0-based
  puzzle: PuzzleBase;
  type: string;
  name: string;
  scope: string;
  depth: string;
  mic: boolean;
  lineIds: string[];
  unitIds: string[];
  target: string | null;
  reason?: string;
}

export function rowsOf(c: DevComposed): DevRow[] {
  return c.practice.puzzles.map((puzzle, i) => {
    const meta = allPuzzleEntries().find((e) => e.logic.type === puzzle.type)?.logic.meta;
    const step = c.report?.steps[i];
    const own = (puzzle as PuzzleBase & { lineId?: string }).lineId;
    return {
      index: i,
      puzzle,
      type: puzzle.type,
      name: meta?.name ?? '(not filled yet)',
      scope: meta?.scope ?? '(not filled yet)',
      depth: meta?.depth ?? '(not filled yet)',
      mic: !!meta?.needsMic,
      lineIds: step?.lineIds ?? (own ? [own] : puzzle.helpLineIds),
      unitIds: puzzle.unitIds,
      target: step?.targetLineId ?? null,
      reason: step?.reason,
    };
  });
}
