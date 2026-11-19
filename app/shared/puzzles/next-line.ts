// "What comes next?" (next-line): a line of the scene loops; three lines of the same scene wait as
// cards, each speaking when its speaker is tapped; the kid picks the one that follows. Two or three
// rounds walk through the scene in order, and after each right pick the two lines play back to back.
// Scope: multi-line. Works on dialogues and on songs (a verse and the next).
//
// A wrong card counts a mistake in that round and greys out; after two the right one glows.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { WRONG_BEFORE_REVEAL } from '../rules';
import { checkHelp, linesById, linesConfusable, normalizeFr, uniq, usableLine } from './arcade';

export interface NextLineRound {
  promptId: string;
  answerId: string;
  choices: string[]; // line ids in display order, the answer among them
}

export interface NextLinePuzzle extends PuzzleBase {
  type: 'next-line';
  rounds: NextLineRound[];
}

export interface NextLineState {
  round: number;
  wrong: string[][]; // per round, line ids picked wrongly
}

export type NextLineAction = { kind: 'pick'; lineId: string };

export const NEXT_LINE_REVEAL_AFTER = WRONG_BEFORE_REVEAL;
export const NEXT_LINE_CHOICES = 3;

export function nextLineRounds(level: number): number {
  return level <= 2 ? 2 : 3;
}

/** Each line's text, as said, appears once in the scene: otherwise "what follows" is ambiguous. */
function uniqueText(scene: Scene, line: Line): boolean {
  const k = normalizeFr(line.fr);
  return scene.lines.filter((l) => normalizeFr(l.fr) === k).length === 1;
}

export const nextLine: PuzzleType<NextLinePuzzle, NextLineState, NextLineAction> & BotHooks<NextLinePuzzle, NextLineState, NextLineAction> = {
  type: 'next-line',
  meta: {
    role: 'recall',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 40,
    weight: 2,
    name: 'What comes next',
    purpose:
      'A line of the scene loops; the kid picks, among three lines that speak when tapped, the one that follows it, over two or three rounds through the scene. Reinforces how the lines follow each other and what they say together.',
    depth: 'core',
    scope: 'multi-line',
  },

  build(ctx: BuildCtx): NextLinePuzzle | null {
    const { scene, rng } = ctx;
    const lines = scene.lines;
    if (lines.length < 3) return null;
    // Candidate pairs: a line and the one after it, both usable, said once each, told apart.
    const pairs: { a: Line; b: Line }[] = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i]!;
      const b = lines[i + 1]!;
      if (!usableLine(a) || !usableLine(b) || b.startMs <= a.startMs) continue;
      if (!uniqueText(scene, a) || !uniqueText(scene, b) || linesConfusable(a.fr, b.fr)) continue;
      pairs.push({ a, b });
    }
    const roundsFor = (pair: { a: Line; b: Line }): NextLineRound | null => {
      const others = rng.shuffle(lines.filter((l) => l.id !== pair.a.id && l.id !== pair.b.id && usableLine(l)));
      const picked: Line[] = [];
      for (const l of others) {
        if (picked.length >= NEXT_LINE_CHOICES - 1) break;
        if (linesConfusable(l.fr, pair.b.fr) || picked.some((p) => linesConfusable(p.fr, l.fr))) continue;
        picked.push(l);
      }
      if (picked.length < 1) return null;
      return { promptId: pair.a.id, answerId: pair.b.id, choices: rng.shuffle([pair.b.id, ...picked.map((l) => l.id)]) };
    };
    // Prefer pairs with the target line, then pairs not used yet; keep scene order in the puzzle.
    const t = ctx.targetLineId;
    const scored = pairs.map((p) => ({
      p,
      score:
        (t && (p.a.id === t || p.b.id === t) ? 100 : 0) -
        Number(ctx.usedLineIds.has(p.a.id)) -
        Number(ctx.usedLineIds.has(p.b.id)) +
        rng.next(),
    }));
    if (t && !scored.some((s) => s.score >= 50)) return null;
    scored.sort((x, y) => y.score - x.score);
    const want = nextLineRounds(ctx.level);
    const chosen: NextLineRound[] = [];
    for (const { p } of scored) {
      if (chosen.length >= want) break;
      const r = roundsFor(p);
      if (r) chosen.push(r);
    }
    if (chosen.length < 1 || (chosen.length < 2 && pairs.length >= 2)) return null;
    const idx = (id: string) => lines.findIndex((l) => l.id === id);
    chosen.sort((x, y) => idx(x.promptId) - idx(y.promptId));
    const used = uniq(chosen.flatMap((r) => [r.promptId, ...r.choices]));
    const inOrder = lines.filter((l) => used.includes(l.id)).map((l) => l.id);
    for (const id of inOrder) ctx.usedLineIds.add(id);
    const key = linesById(scene, uniq(chosen.flatMap((r) => [r.promptId, r.answerId]))).flatMap((l) => l.units.filter((u) => u.key).map((u) => u.id));
    return {
      id: `${scene.id}:next-line:${chosen[0]!.promptId}`,
      type: 'next-line',
      sceneId: scene.id,
      helpLineIds: inOrder,
      unitIds: key,
      rounds: chosen,
    };
  },

  init(puzzle): NextLineState {
    return { round: 0, wrong: puzzle.rounds.map(() => []) };
  },

  reduce(puzzle, state, action): NextLineState {
    if (!action || action.kind !== 'pick' || state.round >= puzzle.rounds.length) return state;
    const r = puzzle.rounds[state.round]!;
    if (!r.choices.includes(action.lineId)) return state;
    if (action.lineId === r.answerId) return { ...state, round: state.round + 1 };
    const mine = state.wrong[state.round] ?? [];
    if (mine.includes(action.lineId)) return state;
    const wrong = state.wrong.slice();
    wrong[state.round] = [...mine, action.lineId];
    return { ...state, wrong };
  },

  isDone(puzzle, state) {
    return state.round >= puzzle.rounds.length;
  },

  mistakes(_puzzle, state) {
    return state.wrong.reduce((a, w) => a + w.length, 0);
  },

  missedUnitIds(puzzle, state) {
    const lines = new Set(puzzle.rounds.filter((_, i) => (state.wrong[i]?.length ?? 0) > 0).flatMap((r) => [r.promptId, r.answerId]));
    return puzzle.unitIds.filter((u) => lines.has(u.slice(0, u.lastIndexOf(':'))));
  },

  solve(puzzle, state): NextLineAction {
    return { kind: 'pick', lineId: puzzle.rounds[state.round]!.answerId };
  },

  wrongAction(puzzle: NextLinePuzzle, state: NextLineState, rng: Rng): NextLineAction | null {
    const r = puzzle.rounds[state.round];
    if (!r) return null;
    const mine = state.wrong[state.round] ?? [];
    const left = r.choices.filter((id) => id !== r.answerId && !mine.includes(id));
    return left.length ? { kind: 'pick', lineId: rng.pick(left) } : null;
  },

  validate(puzzle: NextLinePuzzle, scene: Scene): string[] {
    const p: string[] = [];
    if (puzzle.rounds.length < 1 || puzzle.rounds.length > 4) p.push(`next-line: ${puzzle.rounds.length} rounds`);
    const index = (id: string) => scene.lines.findIndex((l) => l.id === id);
    puzzle.rounds.forEach((r, i) => {
      const a = index(r.promptId);
      const b = index(r.answerId);
      if (a < 0 || b < 0) {
        p.push(`next-line: round ${i}: a line is not in the scene`);
        return;
      }
      if (b !== a + 1) p.push(`next-line: round ${i}: the answer does not follow the prompt`);
      if (!r.choices.includes(r.answerId)) p.push(`next-line: round ${i}: the answer is not a choice`);
      if (r.choices.includes(r.promptId)) p.push(`next-line: round ${i}: the prompt is a choice`);
      if (r.choices.length < 2 || r.choices.length > NEXT_LINE_CHOICES) p.push(`next-line: round ${i}: ${r.choices.length} choices`);
      if (new Set(r.choices).size !== r.choices.length) p.push(`next-line: round ${i}: a choice twice`);
      const ls = linesById(scene, r.choices);
      for (let x = 0; x < ls.length; x++)
        for (let y = x + 1; y < ls.length; y++) if (linesConfusable(ls[x]!.fr, ls[y]!.fr)) p.push(`next-line: round ${i}: two choices read alike`);
      const pr = scene.lines[a]!;
      if (!uniqueText(scene, pr)) p.push(`next-line: round ${i}: the prompt is said twice in the scene`);
    });
    p.push(...checkHelp('next-line', scene, puzzle.helpLineIds, puzzle.rounds.flatMap((r) => [r.promptId, ...r.choices]), puzzle.unitIds));
    return p;
  },
};
