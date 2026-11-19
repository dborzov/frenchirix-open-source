// The practice composer: a practice on ONE scene at one level (1 = bronze to 6 = plutonium; a replay
// is the practice at the scene's current level), covering every line of it from several angles by
// different puzzle types. A practice is played from start to end with no breaks; the kid can leave
// after any puzzle. Microphone puzzles are spaced out over the whole practice (MIC_WINDOW).
//
// Length is set by coverage: each line has a demand per angle, per level (the LEVEL_ANGLES table);
// the practice ends when every demand is met, or nothing more can be built, within the bounds below.
// At each position the composer picks a puzzle type (by the level's role weights, its weight, how often
// it has been used, and whether it serves a demand still open), then the least-covered line that type
// can serve, and asks for exactly that line (BuildCtx.targetLineId). Types that ignore the target are
// steered softly (every other line is marked used) and are credited with what they actually built.
//
// Pure and deterministic for (scene, level, seed, speak, content) and COMPOSER_VERSION: a practice
// continued later is composed again from its stored seed and resumed by count. Bump COMPOSER_VERSION
// whenever a change here (or to a puzzle type's build) would change the puzzles for the same input.
// See docs/app-architecture.md, "How a practice is composed", and docs/checks.md.

import type { ContentIndex, Scene } from '../content';
import '../puzzles/index';
import { allPuzzleTypes } from './registry';
import { replaceMicPuzzle, type AltFit } from './replace';
import { createRng, type Rng } from './rng';
import type { AnyPuzzleType, BuildCtx, PuzzleRole, Practice, PuzzleScope, PuzzleBase } from './types';

/** Stored by the server with each practice; bump it (in version.ts) when the same input would give other puzzles. */
import { COMPOSER_VERSION } from './version';
export { COMPOSER_VERSION };

// ---- Policy (the user reviews these tables) --------------------------------------------------------

/** The angles a line is practised from. 'scene' is the whole scene, done once by the opener. */
export type Angle = 'meaning' | 'rebuild' | 'say' | 'units' | 'context';
export const ANGLES: readonly Angle[] = ['meaning', 'rebuild', 'say', 'units', 'context'];

/**
 * The level table: how many puzzles of each angle every line gets at each level.
 *   meaning  its meaning recognised (listen and choose, funny question)
 *   rebuild  the line rebuilt or completed (rebuild, fill the blanks)
 *   say      the line or its expressions said aloud (only with speaking on)
 *   units    its key words and expressions on their own (match, catapult, true or false, memory)
 *   context  its place among the other lines (order the comic, what comes next, line meanings);
 *            only for scenes of three lines or more
 * `extraUnitsPer`: one more units puzzle for every this many key units beyond the first one.
 * Every practice opens with the whole scene (`place-words`). Two puzzles of one angle on one line are
 * always of different types. Every level is comprehensive; the mix moves from recognising (bronze)
 * towards rebuilding and saying (titanium to plutonium).
 */
export interface LevelRow {
  meaning: number;
  rebuild: number;
  say: number;
  units: number;
  context: number;
  extraUnitsPer: number;
}
/** Keyed by level: 1 bronze, 2 silver, 3 gold, 4 titanium, 5 diamond, 6 plutonium. */
export const LEVEL_ANGLES: Readonly<Record<number, LevelRow>> = {
  //   meaning rebuild say units context
  1: { meaning: 2, rebuild: 1, say: 1, units: 1, context: 1, extraUnitsPer: 3 },
  2: { meaning: 1, rebuild: 2, say: 1, units: 1, context: 1, extraUnitsPer: 3 },
  3: { meaning: 1, rebuild: 2, say: 1, units: 1, context: 1, extraUnitsPer: 3 },
  4: { meaning: 1, rebuild: 2, say: 2, units: 1, context: 1, extraUnitsPer: 4 },
  5: { meaning: 1, rebuild: 2, say: 2, units: 1, context: 1, extraUnitsPer: 4 },
  6: { meaning: 1, rebuild: 2, say: 2, units: 1, context: 1, extraUnitsPer: 4 },
};

/** Clamp a level to 1-6. */
export const clampLevel = (level: number) => Math.max(1, Math.min(6, Math.floor(level || 1)));

/** A line must reach at least this many different angles (fewer only when no puzzle type can serve it). */
export const MIN_ANGLES_PER_LINE = 3;

/** Bounds on the length, whatever the coverage asks for. */
export const PRACTICE_MIN = 12;
export const PRACTICE_MAX = 50;
/**
 * The spacing rule for microphone puzzles: at most MIC_PER_WINDOW in any MIC_WINDOW consecutive
 * puzzles, and never two in a row, so speaking is spread over the whole practice.
 */
export const MIC_WINDOW = 10;
export const MIC_PER_WINDOW = 2;

/**
 * Variety in the order of puzzles, in type and in content (docs/app-architecture.md, "How a practice is
 * composed"). A gap counts positions: a gap of 3 means at least two other puzzles in between.
 * - TYPE_GAP: two puzzles of one type are at least this far apart (TYPE_GAP_PREFERRED when possible).
 * - LINE_GAP: two puzzles about one line (whose content is that line alone, or units of it only) at
 *   least this far apart, so consecutive puzzles move across the scene; never more than the scene's
 *   number of lines (a scene of two lines alternates, one of one line has no such rule).
 * - UNIT_GAP: two unit puzzles (scope 'unit': match, catapult, vrai-faux, memory, the unit speaking
 *   puzzles) on a same unit at least this far apart.
 * At each position the composer first tries TYPE_GAP_PREFERRED (with a filler when nothing that serves
 * an open demand keeps it), then the rule; when nothing that serves an open demand can be built within
 * the rule (a scene with few lines, units or puzzle types that fit), it drops the gaps for that one
 * puzzle, but never puts one type twice in a row, and never for a filler. The step's reason says so; a
 * practice may do that at most VARIETY_SLACK times.
 */
export const TYPE_GAP = 3;
export const TYPE_GAP_PREFERRED = 4;
export const LINE_GAP = 3;
export const UNIT_GAP = 4;
export const VARIETY_SLACK = 3;
/** Variety: a puzzle type used in the last VARIETY_WINDOW puzzles weighs less, the more it was used. */
export const VARIETY_WINDOW = 10;
/** Rhythm: something fun about every FUN_EVERY puzzles (the last three positions of each stretch). */
export const FUN_EVERY = 9;

/** No type more than this share of the practice (but each type may appear at least twice). */
export const PRACTICE_MAX_TYPE_SHARE = 0.2;

/** The first puzzle: the first of these that is registered and builds. */
export const PRACTICE_OPENERS = ['place-words', 'watch'] as const;

/**
 * How the mix shifts with the level: relative weight of each role, among the puzzle types that serve
 * an open demand. Early: more recognition. Later: more recall and speaking.
 */
export const PRACTICE_ROLE_WEIGHTS: Readonly<Record<number, Readonly<Record<Exclude<PuzzleRole, 'intro'>, number>>>> = {
  //   recognise   recall   produce   fun
  1: { recognise: 5, recall: 3, produce: 2, fun: 2 },
  2: { recognise: 4, recall: 4, produce: 2, fun: 2 },
  3: { recognise: 3, recall: 4, produce: 3, fun: 2 },
  4: { recognise: 2, recall: 4, produce: 4, fun: 2 },
  5: { recognise: 2, recall: 4, produce: 4, fun: 2 },
  6: { recognise: 1, recall: 4, produce: 5, fun: 2 },
};

/** The angle a puzzle type serves, from its meta (microphone first, then scope, then role). */
export function angleOf(g: AnyPuzzleType): Angle | 'scene' {
  if (g.meta.scope === 'scene' || g.meta.role === 'intro') return 'scene';
  if (g.meta.needsMic) return 'say';
  if (g.meta.scope === 'multi-line') return 'context';
  if (g.meta.scope === 'unit') return 'units';
  if (g.meta.role === 'recall') return 'rebuild';
  return 'meaning';
}

// ---- Types -------------------------------------------------------------------------------------

export interface PracticeInput {
  id: string;
  seed: number;
  scene: Scene;
  /** The level the practice earns when passed, 1 (bronze) to 6 (plutonium). */
  level?: number;
  speak: boolean;
  bank: ContentIndex['bank'];
  allowedQuestionIds?: string[];
  others?: Scene[]; // other scenes, for distractors
}

export interface PracticeStep {
  index: number; // 1-based position
  puzzleId: string;
  type: string;
  name: string;
  scope: PuzzleScope | 'unknown';
  angle: Angle | 'scene';
  needsMic: boolean;
  targetLineId: string | null; // the line the composer asked for
  lineIds: string[]; // the lines the puzzle is credited to
  unitIds: string[];
  honouredTarget: boolean | null; // null when no single line was asked
  reason: string; // why it was chosen
}

export interface LineCoverage {
  lineId: string;
  demand: Record<Angle, number>;
  got: Record<Angle, number>;
  angles: number; // how many different angles reached
  types: string[];
  shortfall?: string; // why a demand stayed open
}

/** The composer's report on a practice: each puzzle's target and why, coverage per line and angle. */
export interface PracticeReport {
  composerVersion: number;
  level: number;
  length: number;
  plannedLength: number; // what the demands asked for, within the bounds
  steps: PracticeStep[];
  coverage: LineCoverage[];
  typeCounts: Record<string, number>;
  scopes: Record<string, number>;
  /** Puzzle types asked for one line that built another (their owners should honour targetLineId). */
  ignoresTarget: string[];
}

export type ComposedPractice = Practice & {
  problems: string[];
  plan: PracticeReport;
  composerVersion: number;
  level: number;
};

// ---- Helpers -----------------------------------------------------------------------------------

const lineOfUnit = (unitId: string) => unitId.slice(0, unitId.lastIndexOf(':'));

/** The one line a puzzle is about (its content is that line, or units of it only), else null. */
export const focusLine = (st: Pick<PracticeStep, 'angle' | 'lineIds'>): string | null => (st.angle !== 'scene' && st.lineIds.length === 1 ? st.lineIds[0]! : null);

/** The lines a puzzle is credited to for its angle (`known`: the scene's line ids). */
function creditLinesOf(g: AnyPuzzleType, puzzle: PuzzleBase, known: ReadonlySet<string>): string[] {
  const angle = angleOf(g);
  if (angle === 'units' || g.meta.scope === 'unit') return [...new Set(puzzle.unitIds.map(lineOfUnit))].filter((id) => known.has(id));
  const own = (puzzle as PuzzleBase & { lineId?: string }).lineId;
  if (angle !== 'context' && own && known.has(own)) return [own];
  const help = puzzle.helpLineIds.filter((id) => known.has(id));
  if (angle === 'context' || angle === 'scene') return help;
  // A single-line puzzle type without lineId: the line of its units, else its only help line.
  const fromUnits = [...new Set(puzzle.unitIds.map(lineOfUnit))].filter((id) => known.has(id));
  return fromUnits.length === 1 ? fromUnits : help.slice(0, 1);
}

/** The step a microphone puzzle's tapping replacement takes in its place (speaking off). */
function altStepOf(st: PracticeStep, alt: PuzzleBase, g: AnyPuzzleType | undefined, known: ReadonlySet<string>): PracticeStep {
  return {
    ...st,
    puzzleId: alt.id,
    type: alt.type,
    name: g?.meta.name ?? alt.type,
    scope: g?.meta.scope ?? 'unknown',
    angle: g ? angleOf(g) : 'meaning',
    needsMic: false,
    lineIds: g ? creditLinesOf(g, alt, known) : alt.helpLineIds.filter((id) => known.has(id)),
    unitIds: alt.unitIds,
    reason: `replaces ${st.type} when speaking is off`,
  };
}

function weightedOrder<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T[] {
  return items
    .map((item, i) => ({ item, i, key: Math.pow(rng.next(), 1 / Math.max(weight(item), 1e-9)) }))
    .sort((a, b) => b.key - a.key || a.i - b.i)
    .map((x) => x.item);
}

/** The demand of each line, per angle, at a level (the LEVEL_ANGLES row). */
export function practiceDemand(scene: Scene, speak: boolean, level = 1): Map<string, Record<Angle, number>> {
  const row = LEVEL_ANGLES[clampLevel(level)]!;
  const out = new Map<string, Record<Angle, number>>();
  for (const l of scene.lines) {
    const keys = l.units.filter((u) => u.key).length;
    const extraUnits = row.units > 0 ? Math.max(0, Math.floor((keys - 1) / row.extraUnitsPer)) : 0;
    out.set(l.id, {
      meaning: row.meaning,
      rebuild: row.rebuild,
      say: speak ? row.say : 0,
      units: keys > 0 ? row.units + extraUnits : 0,
      context: scene.lines.length >= 3 ? row.context : 0,
    });
  }
  return out;
}

// ---- Composer ----------------------------------------------------------------------------------

/**
 * Where a continued practice starts: at puzzle `done`. When the practice is composed by another
 * composer or from other content than when it was started (`same` false), its puzzles may be others:
 * continue by count, but no later than the last puzzle, so it never finishes without a puzzle played.
 * `length` is the composed length; a result equal to it means every puzzle was played (complete it).
 */
export function resumeIndex(done: number, length: number, same: boolean): number {
  const d = Math.max(0, Math.floor(done || 0));
  return same ? Math.min(d, length) : Math.max(0, Math.min(d, length - 1));
}

/** The practice of a scene at a level (a replay is the practice at the scene's current level). */
export function composePractice(input: PracticeInput, puzzleTypes: AnyPuzzleType[] = allPuzzleTypes()): ComposedPractice {
  const { scene, speak } = input;
  const level = clampLevel(input.level ?? 1);
  const rng = createRng(input.seed).fork(`practice:v${COMPOSER_VERSION}`);
  const problems: string[] = [];
  const roleWeights = PRACTICE_ROLE_WEIGHTS[Math.max(1, Math.min(6, level))]!;
  const allowedQuestions = input.allowedQuestionIds ? new Set(input.allowedQuestionIds) : undefined;
  const fits = (g: AnyPuzzleType) =>
    level >= g.meta.minLevel && level <= g.meta.maxLevel && !(g.meta.needsMic && !speak);
  const eligible = puzzleTypes.filter(fits);
  const players = eligible.filter((g) => angleOf(g) !== 'scene');

  const lineIds = scene.lines.map((l) => l.id);
  const demand = practiceDemand(scene, speak, level);
  const zero = (): Record<Angle, number> => ({ meaning: 0, rebuild: 0, say: 0, units: 0, context: 0 });
  const got = new Map(lineIds.map((id) => [id, zero()]));
  const lineTypes = new Map(lineIds.map((id) => [id, new Set<string>()]));
  const open = (id: string, a: Angle) => demand.get(id)![a] - got.get(id)![a];
  const openTotal = () => lineIds.reduce((n, id) => n + ANGLES.reduce((m, a) => m + Math.max(0, open(id, a)), 0), 0);

  // Planned length: the opener, every single-line demand, and multi-line puzzles of ~3 lines each.
  const singleDemand = lineIds.reduce((n, id) => n + ANGLES.filter((a) => a !== 'context').reduce((m, a) => m + demand.get(id)![a], 0), 0);
  const contextPuzzles = Math.ceil(lineIds.reduce((n, id) => n + demand.get(id)!.context, 0) / 3);
  const minLen = PRACTICE_MIN;
  const maxLen = PRACTICE_MAX;
  const plannedLength = Math.max(minLen, Math.min(maxLen, 1 + singleDemand + contextPuzzles));
  const typeCap = Math.max(2, Math.ceil(plannedLength * PRACTICE_MAX_TYPE_SHARE));

  const typeCounts = new Map<string, number>();
  const scopes = new Map<string, number>();
  const usedLineIds = new Set<string>();
  const usedUnitIds = new Set<string>();
  const failedPairs = new Set<string>(); // `${type}|${line}` that returned null for that target
  const failedFree = new Map<string, number>(); // free-choosing types that built nothing useful, how often
  const FREE_TRIES = 3;
  const ignoresTarget = new Set<string>();
  // A funny question is asked once per practice: the same joke twice in one practice gets old and is
  // a duplicate (intent.md, "Puzzles" and "Variety").
  const askedQuestions = new Set<string>();
  const puzzles: PuzzleBase[] = [];
  const steps: PracticeStep[] = [];

  const ctxFor = (g: AnyPuzzleType, k: number, lineId: string | null): BuildCtx => {
    const ctx: BuildCtx = {
      scene,
      level,
      rng: rng.fork(`p:${k}:${g.type}:${lineId ?? '-'}`),
      focusUnitIds: new Set(),
      others: input.others ?? [],
      bank: input.bank,
      // Soft steering for puzzle types that ignore targetLineId: every other line looks already used.
      usedLineIds: lineId ? new Set(lineIds.filter((id) => id !== lineId)) : new Set(usedLineIds),
      usedUnitIds: new Set(usedUnitIds),
    };
    if (lineId) ctx.targetLineId = lineId;
    const allowed = allowedQuestions ?? (askedQuestions.size ? new Set(scene.questions.map((q) => q.id)) : undefined);
    if (allowed) ctx.allowedQuestionIds = askedQuestions.size ? new Set([...allowed].filter((id) => !askedQuestions.has(id))) : allowed;
    return ctx;
  };

  const tryBuild = (g: AnyPuzzleType, k: number, lineId: string | null): PuzzleBase | null => {
    try {
      return g.build(ctxFor(g, k, lineId));
    } catch (err) {
      problems.push(`${scene.id}: puzzle type ${g.type} threw in build: ${(err as Error).message}`);
      return null;
    }
  };

  /** The lines a puzzle is credited to for its angle. */
  const known = new Set(lineIds);
  const creditLines = (g: AnyPuzzleType, puzzle: PuzzleBase): string[] => creditLinesOf(g, puzzle, known);

  const angleCount = (id: string) => ANGLES.filter((a) => got.get(id)![a] > 0).length;
  // The spacing rule: a microphone puzzle may come next only when the last MIC_WINDOW - 1 puzzles hold
  // fewer than MIC_PER_WINDOW of them (so no MIC_WINDOW consecutive puzzles hold more) and the last
  // puzzle is not one.
  const micAllowed = () =>
    !steps[steps.length - 1]?.needsMic && steps.slice(-(MIC_WINDOW - 1)).filter((st) => st.needsMic).length < MIC_PER_WINDOW;

  // Content spacing (TYPE_GAP, LINE_GAP, UNIT_GAP): what the last few puzzles were about.
  const recentSteps = (gap: number) => (gap > 1 ? steps.slice(-(gap - 1)) : []);
  const recentLines = (gap: number) => new Set(recentSteps(gap).map(focusLine).filter((x): x is string => !!x));
  const recentUnits = (gap: number) => new Set(recentSteps(gap).filter((st) => st.scope === 'unit').flatMap((st) => st.unitIds));
  /** The gaps at a level of strictness: 2 the preferred type gap, 1 the rule, 0 only never the same type twice in a row. */
  const gapsAt = (level: 0 | 1 | 2) =>
    level === 0
      ? { type: 2, line: 1, unit: 1 }
      : { type: level === 2 ? TYPE_GAP_PREFERRED : TYPE_GAP, line: Math.min(LINE_GAP, lineIds.length), unit: UNIT_GAP };
  /** A built puzzle keeps the content gaps: not about a line or (for a unit puzzle) a unit practised just before. */
  const spaced = (g: AnyPuzzleType, built: PuzzleBase, gaps: { line: number; unit: number }) => {
    const lines = creditLines(g, built);
    if (angleOf(g) !== 'scene' && lines.length === 1 && recentLines(gaps.line).has(lines[0]!)) return false;
    if (g.meta.scope === 'unit') {
      const near = recentUnits(gaps.unit);
      if (built.unitIds.some((u) => near.has(u))) return false;
    }
    return true;
  };

  const accept = (g: AnyPuzzleType, built: PuzzleBase, lineId: string | null, reason: string) => {
    const k = puzzles.length + 1;
    const puzzle: PuzzleBase = { ...built, id: `${scene.id}:p${k}:${built.type}` };
    const angle = angleOf(g);
    const lines = creditLines(g, puzzle);
    if (angle !== 'scene') {
      for (const id of lines) {
        got.get(id)![angle] += 1;
        lineTypes.get(id)!.add(g.type);
      }
    }
    for (const id of puzzle.helpLineIds) usedLineIds.add(id);
    for (const u of puzzle.unitIds) usedUnitIds.add(u);
    const questionId = (puzzle as PuzzleBase & { questionId?: string }).questionId;
    if (questionId) askedQuestions.add(questionId);
    typeCounts.set(g.type, (typeCounts.get(g.type) ?? 0) + 1);
    const scope = g.meta.scope ?? 'unknown';
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    const honoured = lineId ? lines.includes(lineId) : null;
    if (honoured === false && angle !== 'units' && g.meta.scope !== 'unit') ignoresTarget.add(g.type);
    puzzles.push(puzzle);
    steps.push({
      index: k,
      puzzleId: puzzle.id,
      type: g.type,
      name: g.meta.name ?? g.type,
      scope,
      angle,
      needsMic: g.meta.needsMic,
      targetLineId: lineId,
      lineIds: lines,
      unitIds: puzzle.unitIds,
      honouredTarget: honoured,
      reason,
    });
  };

  // 1. The opener: the whole scene.
  for (const type of PRACTICE_OPENERS) {
    const g = eligible.find((x) => x.type === type);
    if (!g) continue;
    const built = tryBuild(g, 1, null);
    if (built) {
      accept(g, built, null, type === 'place-words' ? 'opener: the whole scene, placing its words' : 'opener: the whole scene (place-words not available)');
      break;
    }
  }
  if (puzzles.length === 0) problems.push(`${scene.id}: no opener (place-words or watch) could be built`);

  // 2. The rest, one position at a time, until every demand is met or nothing can serve one. At each
  // position: a puzzle that serves an open demand within the preferred gaps, else a filler (variety only)
  // within them; then the same within the rule; last a puzzle that serves a demand with the gaps dropped.
  // A filler before the rule's gap: when the open demand is left to two or three types (often rebuild,
  // fill-blanks and listen-pick at the end of a long scene), they would otherwise take turns.
  let fillers = 0;
  const ATTEMPTS: { level: 0 | 1 | 2; fillers: boolean }[] = [
    { level: 2, fillers: false },
    { level: 2, fillers: true },
    { level: 1, fillers: false },
    { level: 1, fillers: true },
    { level: 0, fillers: false },
  ];
  while (puzzles.length < maxLen) {
    const k = puzzles.length + 1;
    const index0 = k - 1;
    const funSpot = index0 % FUN_EVERY >= FUN_EVERY - 3;
    const window = steps.slice(-VARIETY_WINDOW).map((s) => s.type);
    const remaining = openTotal();
    if (remaining === 0 && puzzles.length >= Math.min(minLen, plannedLength)) break;

    const opensNewAngle = (g: AnyPuzzleType) => {
      const a = angleOf(g);
      return a !== 'scene' && lineIds.some((id) => got.get(id)![a] === 0 && demand.get(id)![a] > 0);
    };
    const serves = (g: AnyPuzzleType) => {
      const a = angleOf(g);
      return a !== 'scene' && lineIds.some((id) => open(id, a) > 0);
    };
    const weight = (g: AnyPuzzleType) => {
      const roleW = roleWeights[g.meta.role as Exclude<PuzzleRole, 'intro'>] ?? 1;
      const uses = typeCounts.get(g.type) ?? 0;
      let w = (roleW * g.meta.weight) / (1 + uses) ** 2;
      if (!serves(g)) w *= 0.02;
      else if (!opensNewAngle(g)) w *= 0.4; // breadth first: a new angle on some line beats a second one
      w *= 0.3 ** window.filter((t) => t === g.type).length; // variety: the more a type was seen lately, the less
      if (funSpot && g.meta.role === 'fun') w *= 4; // something fun every few puzzles
      if (g.meta.needsMic && !typeCounts.has(g.type)) w *= 6; // every microphone kind at least once
      return w;
    };

    /** How many credited lines of a built puzzle still had its angle open. */
    const gain = (g: AnyPuzzleType, built: PuzzleBase) => {
      const a = angleOf(g);
      return a === 'scene' ? 0 : creditLines(g, built).filter((id) => open(id, a) > 0).length;
    };
    // Builds are deterministic per position, type and target: cache them across the attempts, and
    // count a free-choosing type's failure once per position.
    const builds = new Map<string, PuzzleBase | null>();
    const build = (g: AnyPuzzleType, lineId: string | null) => {
      const key = `${g.type}|${lineId ?? '-'}`;
      if (!builds.has(key)) builds.set(key, tryBuild(g, k, lineId));
      return builds.get(key)!;
    };
    const failedHere = new Set<string>();
    const order0 = weightedOrder(players, weight, rng);

    const attempt = ({ level, fillers: fillersOk }: { level: 0 | 1 | 2; fillers: boolean }): boolean => {
      const gaps = gapsAt(level);
      const nearTypes = new Set(recentSteps(gaps.type).map((st) => st.type));
      const nearLines = recentLines(gaps.line);
      const relaxed = level === 0 ? ', spacing dropped' : '';
      for (const g of order0) {
        if (nearTypes.has(g.type) || (typeCounts.get(g.type) ?? 0) >= typeCap || (g.meta.needsMic && !micAllowed())) continue;
        const angle = angleOf(g) as Angle;
        const helpful = serves(g);
        if (!helpful && (!fillersOk || (remaining > 0 && fillers >= 2))) continue;
        const scope = g.meta.scope;
        if (angle === 'context' || angle === 'units' || scope === 'unit' || scope === 'multi-line') {
          // These pick several lines themselves; steer toward the least-covered line of that angle, not one just practised.
          if ((failedFree.get(g.type) ?? 0) >= FREE_TRIES) continue;
          const target = rng
            .shuffle(lineIds)
            .sort(
              (a, b) =>
                Number(nearLines.has(a)) - Number(nearLines.has(b)) ||
                Number(got.get(a)![angle] === 0) * -1 + Number(got.get(b)![angle] === 0) ||
                angleCount(a) - angleCount(b) ||
                open(b, angle) - open(a, angle),
            )[0]!;
          const options = [build(g, target), build(g, null)].filter((x): x is PuzzleBase => !!x && (!helpful || gain(g, x) > 0));
          if (!options.length) {
            // Nothing, or nothing that serves an open demand (the puzzle type chose lines already covered).
            if (!failedHere.has(g.type)) failedFree.set(g.type, (failedFree.get(g.type) ?? 0) + 1);
            failedHere.add(g.type);
            continue;
          }
          const built = options.find((x) => spaced(g, x, gaps));
          if (!built) continue;
          const lineId = built === options[0] && builds.get(`${g.type}|${target}`) === built ? target : null;
          accept(g, built, lineId, `${helpful ? `open ${angle} demand` : 'filler (variety; no open demand it can serve)'}${funSpot && g.meta.role === 'fun' ? ', something fun' : ''}${relaxed}`);
          fillers = helpful ? 0 : fillers + 1;
          return true;
        }
        // Single-line puzzle types: the line with this angle most open, then the least covered overall;
        // not a line just practised.
        const covered = (id: string) => ANGLES.reduce((n, a) => n + Math.min(got.get(id)![a], demand.get(id)![a]), 0);
        const order = rng
          .shuffle(lineIds)
          .filter((id) => !failedPairs.has(`${g.type}|${id}`) && !nearLines.has(id))
          .sort(
            (a, b) =>
              Number(open(b, angle) > 0) - Number(open(a, angle) > 0) ||
              Number(got.get(b)![angle] === 0) - Number(got.get(a)![angle] === 0) ||
              angleCount(a) - angleCount(b) ||
              Number(lineTypes.get(a)!.has(g.type)) - Number(lineTypes.get(b)!.has(g.type)) ||
              covered(a) - covered(b),
          );
        for (const id of order) {
          if (helpful && open(id, angle) <= 0) break; // the rest of the order serves nothing
          if (helpful && lineTypes.get(id)!.has(g.type)) continue; // a line gets different types
          const built = build(g, id);
          if (!built || (helpful && gain(g, built) === 0)) {
            failedPairs.add(`${g.type}|${id}`);
            continue;
          }
          if (!spaced(g, built, gaps)) continue;
          accept(g, built, id, `${helpful ? `open ${angle} demand on ${id}` : `filler (variety; no open demand it can serve) on ${id}`}${relaxed}`);
          fillers = helpful ? 0 : fillers + 1;
          return true;
        }
      }
      return false;
    };
    if (!ATTEMPTS.some(attempt)) break; // nothing can serve what is still open: the practice ends here
  }
  // Trailing fillers serve nothing: drop them unless they keep the practice at its minimum.
  while (
    steps.length > Math.min(minLen, plannedLength) &&
    steps.length > 1 &&
    steps[steps.length - 1]!.reason.startsWith('filler')
  ) {
    const st = steps.pop()!;
    puzzles.pop();
    typeCounts.set(st.type, typeCounts.get(st.type)! - 1);
    scopes.set(st.scope, scopes.get(st.scope)! - 1);
    if (st.angle !== 'scene') for (const id of st.lineIds) got.get(id)![st.angle] -= 1;
  }

  // 3. The tapping replacement of each microphone puzzle (`alt`), chosen now that the whole practice is
  // known: a kid who turns speaking off mid-practice plays it in its place, so it keeps the variety
  // rule with the puzzles on both sides, in either of their forms (docs/app-architecture.md).
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  const altSteps: (PracticeStep | undefined)[] = [];
  const lineGap = Math.min(LINE_GAP, lineIds.length);
  steps.forEach((st, i) => {
    const g = byType.get(st.type);
    if (!st.needsMic || !g) return;
    const forms = (j: number) => (j < 0 || j >= steps.length ? [] : altSteps[j] ? [steps[j]!, altSteps[j]!] : [steps[j]!]);
    // It also keeps to PRACTICE_MAX_TYPE_SHARE, counting the replacements chosen so far.
    const fit: AltFit = (alt) => {
      const f = fitAmong(altStepOf(st, alt, byType.get(alt.type), known), i, steps.length, forms, lineIds.length);
      return f === 2 && steps.filter((x, j) => (altSteps[j] ?? x).type === alt.type).length >= typeCap ? 1 : f;
    };
    // What the puzzles around it are about counts as used: a replacement that picks its own line or
    // fills its board with other units (match) takes them away from there.
    const nearLines = new Set<string>();
    const nearUnits = new Set<string>();
    for (let d = 1; d < Math.max(lineGap, UNIT_GAP); d++)
      for (const x of [...forms(i - d), ...forms(i + d)]) {
        const line = focusLine(x);
        if (line && d < lineGap) nearLines.add(line);
        if (x.scope === 'unit' && d < UNIT_GAP) x.unitIds.forEach((u) => nearUnits.add(u));
      }
    const ctx = { ...ctxFor(g, st.index, st.targetLineId), usedLineIds: nearLines, usedUnitIds: nearUnits };
    const r = replaceMicPuzzle(puzzles[i]!, scene, ctx, puzzleTypes, fit);
    if (!r) {
      problems.push(`${scene.id}: no tapping replacement for ${st.type} ${st.puzzleId}`);
      return;
    }
    puzzles[i] = { ...puzzles[i]!, alt: r.puzzle };
    altSteps[i] = altStepOf(st, r.puzzle, byType.get(r.puzzle.type), known);
  });

  const coverage: LineCoverage[] = lineIds.map((id) => {
    const d = demand.get(id)!;
    const g = got.get(id)!;
    const row: LineCoverage = {
      lineId: id,
      demand: { ...d },
      got: { ...g },
      angles: ANGLES.filter((a) => g[a] > 0).length,
      types: [...lineTypes.get(id)!],
    };
    const openAngles = ANGLES.filter((a) => g[a] < d[a]);
    if (openAngles.length) {
      const line = scene.lines.find((l) => l.id === id)!;
      const tried = players.filter((p) => failedPairs.has(`${p.type}|${id}`)).map((p) => p.type);
      row.shortfall =
        `open: ${openAngles.join(', ')}` +
        (tried.length ? `; returned null for it: ${tried.join(', ')}` : '') +
        (line.approxTimes ? '; the line has approxTimes' : '');
    }
    return row;
  });

  const plan: PracticeReport = {
    composerVersion: COMPOSER_VERSION,
    level,
    length: puzzles.length,
    plannedLength,
    steps,
    coverage,
    typeCounts: Object.fromEntries([...typeCounts].filter(([, c]) => c > 0)),
    scopes: Object.fromEntries([...scopes].filter(([, c]) => c > 0)),
    ignoresTarget: [...ignoresTarget].sort(),
  };
  return {
    id: input.id,
    seed: input.seed,
    kind: 'practice',
    entries: [{ sceneId: scene.id, level, due: true }],
    puzzles,
    problems,
    plan,
    composerVersion: COMPOSER_VERSION,
    level,
  };
}

/** The report of a practice, for the dev page: each puzzle's type, target, lines, units and why. */
export function practiceReport(input: PracticeInput, puzzleTypes: AnyPuzzleType[] = allPuzzleTypes()): PracticeReport {
  return composePractice(input, puzzleTypes).plan;
}

/** Policy problems of a composed practice (the checks and tests use it). */
export function checkPracticePolicy(p: ComposedPractice, speak: boolean, puzzleTypes: AnyPuzzleType[] = allPuzzleTypes()): string[] {
  const out: string[] = [];
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  const n = p.puzzles.length;
  if (n > PRACTICE_MAX) out.push(`${n} puzzles, over ${PRACTICE_MAX}`);
  for (let i = 1; i < n; i++) if (p.puzzles[i]!.type === p.puzzles[i - 1]!.type) out.push(`${p.puzzles[i]!.type} twice in a row at ${i + 1}`);
  const opener = PRACTICE_OPENERS.find((t) => byType.has(t));
  if (opener && p.puzzles[0]?.type !== opener) out.push(`starts with ${p.puzzles[0]?.type ?? 'nothing'}, not ${opener}`);
  const cap = Math.max(2, Math.ceil(p.plan.plannedLength * PRACTICE_MAX_TYPE_SHARE));
  for (const [t, c] of Object.entries(p.plan.typeCounts)) if (c > cap) out.push(`${t} appears ${c} times (at most ${cap})`);
  for (const t of p.puzzles) if (!speak && byType.get(t.type)?.meta.needsMic) out.push(`microphone puzzle type ${t.type} with speak off`);
  out.push(...micSpacingProblems(p.puzzles.map((t) => !!byType.get(t.type)?.meta.needsMic)));
  const v = varietyBreaks(p.plan.steps, p.plan.coverage.length);
  if (v.length > VARIETY_SLACK) out.push(`${v.length} puzzles come too soon after a similar one (at most ${VARIETY_SLACK}): ${v.slice(0, 4).join('; ')}`);
  for (const c of p.plan.coverage) {
    const possible = ANGLES.filter((a) => c.demand[a] > 0).length;
    const need = Math.min(MIN_ANGLES_PER_LINE, possible);
    if (c.angles < need && !c.shortfall?.includes('returned null')) out.push(`line ${c.lineId} reached ${c.angles} angles (${need} wanted): ${c.shortfall ?? ''}`);
  }
  return out;
}

/** The spacing rule over a practice (true = a microphone puzzle at that position): what breaks it. */
export function micSpacingProblems(mic: readonly boolean[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < mic.length; i++) if (mic[i] && mic[i - 1]) out.push(`microphone puzzles in a row at ${i} and ${i + 1}`);
  for (let i = 0; i + MIC_WINDOW <= Math.max(mic.length, MIC_WINDOW); i++) {
    const n = mic.slice(i, i + MIC_WINDOW).filter(Boolean).length;
    if (n > MIC_PER_WINDOW) {
      out.push(`${n} microphone puzzles in puzzles ${i + 1}-${Math.min(mic.length, i + MIC_WINDOW)} (at most ${MIC_PER_WINDOW} in any ${MIC_WINDOW})`);
      break;
    }
  }
  return out;
}

/**
 * The steps of a practice as played when speaking is turned off at puzzle `from` (0-based): from there
 * on, each microphone puzzle is its tapping replacement. The checks hold these to the variety rule too.
 */
export function speakingOffSteps(p: ComposedPractice, from = 0, puzzleTypes: AnyPuzzleType[] = allPuzzleTypes()): PracticeStep[] {
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  const known = new Set(p.plan.coverage.map((c) => c.lineId));
  return p.plan.steps.map((st, i) => {
    const alt = p.puzzles[i]?.alt;
    return i >= from && st.needsMic && alt ? altStepOf(st, alt, byType.get(alt.type), known) : st;
  });
}

/**
 * How well step `cand` fits at position `i` of `n` among the puzzles around it, each in any of the forms
 * `forms(j)` returns (a microphone puzzle and its replacement): 2 keeps the variety rule both ways,
 * 1 breaks it but is not the type of the puzzle just before or after, 0 is.
 */
function fitAmong(cand: PracticeStep, i: number, n: number, forms: (j: number) => PracticeStep[], lineCount: number): 0 | 1 | 2 {
  const lineGap = Math.min(LINE_GAP, lineCount);
  const line = focusLine(cand);
  let fit: 0 | 1 | 2 = 2;
  for (let d = 1; d < Math.max(TYPE_GAP, lineGap, UNIT_GAP); d++) {
    for (const j of [i - d, i + d]) {
      if (j < 0 || j >= n) continue;
      for (const x of forms(j)) {
        if (x.type === cand.type && d === 1) return 0;
        if (x.type === cand.type && d < TYPE_GAP) fit = 1;
        if (line && d < lineGap && focusLine(x) === line) fit = 1;
        if (cand.scope === 'unit' && x.scope === 'unit' && d < UNIT_GAP && x.unitIds.some((u) => cand.unitIds.includes(u))) fit = 1;
      }
    }
  }
  return fit;
}

/**
 * Where a practice breaks the variety rule (TYPE_GAP, LINE_GAP capped by the scene's lines, UNIT_GAP
 * between unit puzzles): one entry per puzzle that comes too soon after a similar one, saying why.
 */
export function varietyBreaks(steps: readonly Pick<PracticeStep, 'index' | 'type' | 'angle' | 'scope' | 'lineIds' | 'unitIds'>[], lineCount: number): string[] {
  const out: string[] = [];
  const lineGap = Math.min(LINE_GAP, lineCount);
  steps.forEach((st, i) => {
    const before = (gap: number) => steps.slice(Math.max(0, i - gap + 1), i);
    const why: string[] = [];
    const t = before(TYPE_GAP).find((x) => x.type === st.type);
    if (t) why.push(`${st.type} at ${t.index}`);
    const line = focusLine(st);
    const l = line && before(lineGap).find((x) => focusLine(x) === line);
    if (l) why.push(`line ${line} at ${l.index}`);
    if (st.scope === 'unit') {
      const u = before(UNIT_GAP).find((x) => x.scope === 'unit' && x.unitIds.some((id) => st.unitIds.includes(id)));
      if (u) why.push(`a unit of it at ${u.index}`);
    }
    if (why.length) out.push(`${st.index} (${why.join(', ')})`);
  });
  return out;
}
