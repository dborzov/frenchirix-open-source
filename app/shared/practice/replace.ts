// The tapping equivalent of a microphone round, for a kid who cannot speak right now ("Je ne peux
// pas parler"). The composer attaches it to every microphone puzzle as `puzzle.alt`; the practice shell
// plays it instead whenever speaking is off, so the kid still works on the French they were about to
// say. Pure and deterministic (a fork of the composer's rng), covered by the practice checks.
//
// What replaces what:
// - A whole line (say-line, act-line, say-choice) -> rebuild of that line: hear it, tap its pieces in
//   the order heard. The closest tapping form of "say this line": the kid rebuilds the whole sentence.
// - say-hidden (a unit) -> fill-blanks on its line with exactly that unit
//   blanked: the kid must pick that expression, from memory, among distractors, with the line's
//   English as the meaning cue. That is recall of the expression itself; a word-level rebuild of the
//   unit would only reorder words already shown on screen.
// - A chain of words (say-chain) -> match with those words on the board, else catapult them.
// - When that cannot be built (a line too short or with repeated pieces, a unit that cannot be a
//   blank), or does not fit where it stands: the other of the two on the same line, then listen-pick,
//   match (that expression or the line's key units on the board), catapult, vrai-faux and line-meaning
//   on the same line, then any tapping puzzle type on the same scene. Never nothing: watch as the very
//   last resort.
// - The composer chooses each replacement once the whole practice is composed, with `fit`: the first
//   try of that order that keeps the variety rule with the puzzles on both sides (not the type of the
//   two before or the two after, nor their line or units too close), so that speaking turned off
//   mid-practice does not put rebuild after rebuild (docs/app-architecture.md, "Microphone puzzles").

import type { Scene } from '../content';
import { allPuzzleTypes } from './registry';
import type { AnyPuzzleType, BuildCtx, PuzzleBase } from './types';

/** How close the replacement stayed to the microphone round. */
export type AltCloseness = 'same-french' | 'same-line' | 'same-scene' | 'watch';

interface Try {
  type: string;
  targetLineId?: string;
  targetUnitIds?: string[];
  closeness: AltCloseness;
}

/** The order of tries for a microphone puzzle (exported for tests and docs). */
export function replacementPlan(puzzle: PuzzleBase): Try[] {
  const t = puzzle as PuzzleBase & { lineId?: string; unitId?: string };
  const lineId = t.lineId;
  const unitId = t.unitId;
  const out: Try[] = [];
  if (lineId) {
    if (unitId) {
      out.push({ type: 'fill-blanks', targetLineId: lineId, targetUnitIds: [unitId], closeness: 'same-french' });
      out.push({ type: 'rebuild', targetLineId: lineId, closeness: 'same-line' });
    } else {
      out.push({ type: 'rebuild', targetLineId: lineId, closeness: 'same-french' });
    }
    out.push({ type: 'fill-blanks', targetLineId: lineId, closeness: 'same-line' });
    out.push({ type: 'listen-pick', targetLineId: lineId, closeness: 'same-line' });
    // A line too short for any of those (one word, half a second): match with its expression on the board.
    out.push({ type: 'match', targetUnitIds: unitId ? [unitId] : puzzle.unitIds, closeness: 'same-line' });
    // Other tapping rounds on that line's French, so the composer can avoid the types around it.
    out.push({ type: 'catapult', targetLineId: lineId, ...(unitId ? { targetUnitIds: [unitId] } : {}), closeness: 'same-line' });
    out.push({ type: 'vrai-faux', targetLineId: lineId, closeness: 'same-line' });
    out.push({ type: 'line-meaning', targetLineId: lineId, closeness: 'same-line' });
  } else if (puzzle.unitIds.length) {
    // A chain of words (say-chain): match those words with their meanings, else catapult them.
    out.push({ type: 'match', targetUnitIds: puzzle.unitIds, closeness: 'same-french' });
    out.push({ type: 'catapult', targetUnitIds: puzzle.unitIds, closeness: 'same-french' });
  }
  for (const type of ['rebuild', 'fill-blanks', 'listen-pick', 'match']) out.push({ type, closeness: 'same-scene' });
  out.push({ type: 'watch', closeness: 'watch' });
  return out;
}

export interface Replacement {
  puzzle: PuzzleBase;
  closeness: AltCloseness;
}

/**
 * How well a candidate replacement sits among the puzzles around it (the composer's judgement):
 * 2 keeps the variety rule (and the type's share of the practice), 1 does not but is not the type of
 * the puzzle just before or after, 0 is that type.
 */
export type AltFit = (alt: PuzzleBase) => 0 | 1 | 2;

const isClose = (c: AltCloseness) => c === 'same-french' || c === 'same-line';

/**
 * The tapping round that replaces microphone puzzle `puzzle` on `scene`, built with a copy of `ctx`
 * (its used-line and used-unit sets are not changed, so the rest of the practice does not move).
 * Its id is `<puzzle id>~<type>`. Null only when not even `watch` is registered.
 * Without `fit`: the first try of `replacementPlan` that builds. With it: the first try that fits (2),
 * the tries coming closest first (the same French, the same line, then the scene); else the first on
 * the same French or line that is at least not next to its own type (1); else the first anywhere that
 * is not; else the first that builds.
 */
export function replaceMicPuzzle(puzzle: PuzzleBase, scene: Scene, ctx: BuildCtx, puzzleTypes: readonly AnyPuzzleType[] = allPuzzleTypes(), fit?: AltFit): Replacement | null {
  const byType = new Map(puzzleTypes.map((g) => [g.type, g]));
  // After the plan, any other tapping puzzle type of the set (puzzle types outside the usual ones, test sets).
  const extra: Try[] = [...puzzleTypes]
    .filter((g) => !g.meta.needsMic && !replacementPlan(puzzle).some((x) => x.type === g.type))
    .sort((a, b) => Number(a.meta.role === 'intro') - Number(b.meta.role === 'intro'))
    .map((g) => ({ type: g.type, closeness: g.meta.role === 'intro' ? 'watch' : 'same-scene' }));
  const built: { r: Replacement; fit: number }[] = [];
  const best = (ok: (x: { r: Replacement; fit: number }) => boolean) => built.find(ok)?.r;
  for (const tr of [...replacementPlan(puzzle), ...extra]) {
    const puzzleType = byType.get(tr.type);
    if (!puzzleType || puzzleType.meta.needsMic) continue;
    const c: BuildCtx = {
      ...ctx,
      scene,
      rng: ctx.rng.fork(`alt:${puzzle.id}:${tr.type}:${tr.closeness}`),
      usedLineIds: new Set(ctx.usedLineIds),
      usedUnitIds: new Set(ctx.usedUnitIds),
      ...(tr.targetLineId ? { targetLineId: tr.targetLineId } : {}),
      ...(tr.targetUnitIds ? { targetUnitIds: tr.targetUnitIds } : {}),
    };
    if (!tr.targetLineId) delete c.targetLineId;
    if (!tr.targetUnitIds) delete c.targetUnitIds;
    let made: PuzzleBase | null = null;
    try {
      made = puzzleType.build(c);
    } catch {
      made = null;
    }
    if (!made) continue;
    const { alt: _drop, ...plain } = made;
    void _drop;
    const r: Replacement = { puzzle: { ...plain, id: `${puzzle.id}~${made.type}` }, closeness: tr.closeness };
    if (!fit) return r;
    const f = fit(r.puzzle);
    if (f === 2 && tr.closeness !== 'watch') return r;
    built.push({ r, fit: f });
  }
  return (
    best((x) => isClose(x.r.closeness) && x.fit >= 1) ??
    best((x) => x.r.closeness !== 'watch' && x.fit >= 1) ??
    built[0]?.r ??
    null
  );
}

/** How close a composed puzzle's replacement stayed to it (for the checks' summary). */
export function altCloseness(puzzle: PuzzleBase): AltCloseness | null {
  const alt = puzzle.alt;
  if (!alt) return null;
  if (alt.type === 'watch') return 'watch';
  const t = puzzle as PuzzleBase & { lineId?: string; unitId?: string };
  const a = alt as PuzzleBase & { lineId?: string; blanks?: { unitId: string }[] };
  if (!t.lineId && (alt.type === 'match' || alt.type === 'catapult') && alt.unitIds.some((u) => puzzle.unitIds.includes(u))) return 'same-french';
  if (!t.lineId || a.lineId !== t.lineId) return t.lineId && alt.helpLineIds.includes(t.lineId) ? 'same-line' : 'same-scene';
  const first = replacementPlan(puzzle)[0]!;
  if (alt.type !== first.type) return 'same-line';
  if (t.unitId) return a.blanks?.length === 1 && a.blanks[0]!.unitId === t.unitId ? 'same-french' : 'same-line';
  return 'same-french';
}
