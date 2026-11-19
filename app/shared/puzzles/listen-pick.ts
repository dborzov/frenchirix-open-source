// "Listen and choose": a line of the scene loops; the kid picks its English among five.
// The worked example in docs/app-games.md.
//
// Distractors come from the scene's other lines, then the practice's other scenes, then the content
// bank; no two of the five nearly equal or saying mostly the same things (linesShareMeaning), and no
// wrong one the English of French much like the line's, nor two from look-alike French
// (docs/app-games.md, "Choices"). A wrong pick counts a mistake and greys that choice out; after two
// wrong picks the view makes the right one glow.

import type { Line, Scene } from '../content';
import type { BotHooks } from '../practice/bot';
import type { Rng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { frLinesShareWords, linesShareMeaning } from './distinct';

export interface ListenPickChoice {
  en: string;
  correct: boolean;
}

export interface ListenPickPuzzle extends PuzzleBase {
  type: 'listen-pick';
  lineId: string;
  choices: ListenPickChoice[]; // CHOICES of them, exactly one correct, in display order
}

export interface ListenPickState {
  wrong: number[]; // indices picked wrongly, in order
  picked: number | null; // the right index once picked
}

export type ListenPickAction = { kind: 'pick'; index: number };

export const CHOICES = 5;
/** After this many wrong picks the right choice is shown (the view makes it glow). */
export const REVEAL_AFTER = 2;

/** Lower case, no punctuation or dashes, single spaces: the form compared for equality. */
export function normalizeEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return normalizeEn(s).split(' ').filter(Boolean);
}

/**
 * Two glosses too close to tell apart for a kid: equal once normalised (case, punctuation), one
 * contained in the other, the same start (first three words, or all of a shorter one), or almost the
 * same words.
 */
export function nearlyEqual(a: string, b: string): boolean {
  const na = normalizeEn(a);
  const nb = normalizeEn(b);
  if (!na || !nb) return na === nb;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = words(a);
  const wb = words(b);
  const k = Math.min(3, wa.length, wb.length);
  if (k >= 2 && wa.slice(0, k).join(' ') === wb.slice(0, k).join(' ')) return true;
  const sa = new Set(wa);
  const sb = new Set(wb);
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  const union = sa.size + sb.size - common;
  if (union > 0 && common / union >= 0.75) return true;
  // One is the other with a word or two added ("No." / "No, no.").
  const [short, long] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  if (short.size >= 1 && [...short].every((w) => long.has(w)) && long.size - short.size <= 1) return true;
  return false;
}

/** The English shown for a line: one line of text (dialogue turns joined with a space). */
export function displayEn(en: string): string {
  // Dialogue turns ("- Is it you?\n- No.") become one line: "Is it you? – No."
  return en
    .replace(/^\s*-\s+/, '')
    .replace(/\s*\n\s*-\s+/g, ' – ')
    .replace(/([^.!?,;:–])\s*\n\s*/g, '$1, ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function usable(line: Line): boolean {
  return words(line.en).length > 0 && line.endMs - line.startMs >= 500 && line.units.length > 0;
}

function lengthOk(answer: string, candidate: string): boolean {
  const a = displayEn(answer).length;
  const c = displayEn(candidate).length;
  return c >= a / 3 && c <= a * 3 + 10;
}

export const listenPick: PuzzleType<ListenPickPuzzle, ListenPickState, ListenPickAction> & BotHooks<ListenPickPuzzle, ListenPickState, ListenPickAction> = {
  type: 'listen-pick',
  meta: {
    role: 'recognise',
    minLevel: 1,
    maxLevel: 6,
    needsMic: false,
    seconds: 22,
    weight: 3,
    name: 'Listen and choose',
    purpose:
      'A line of the scene loops; the kid picks its English among five. Reinforces understanding a whole line by ear.',
    depth: 'intro',
    scope: 'line',
  },

  build(ctx: BuildCtx): ListenPickPuzzle | null {
    const { scene, rng, focusUnitIds, usedLineIds } = ctx;
    const r = rng;
    const candidates = scene.lines.filter((l) => usable(l) && (!ctx.targetLineId || l.id === ctx.targetLineId));
    if (!candidates.length) return null;
    // Prefer lines not used yet in this practice, with the kid's weak units, of a decent length.
    const scored = candidates.map((l) => {
      const focus = l.units.filter((u) => focusUnitIds.has(u.id)).length;
      const n = words(l.en).length;
      const score = focus * 3 + (n >= 3 && n <= 16 ? 2 : 0) + r.next() * 2;
      return { l, score, used: usedLineIds.has(l.id) };
    });
    // Lines already used in this practice come last, whatever their score.
    scored.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);

    for (const { l: line } of scored) {
      const answer = displayEn(line.en);
      const pools: { fr: string; en: string }[][] = [
        r.shuffle(scene.lines.filter((x) => x.id !== line.id)),
        r.shuffle(ctx.others.flatMap((o) => o.lines)),
        r.shuffle(ctx.bank.lines),
      ];
      const picked: { fr: string; en: string }[] = [];
      const ok = (c: { fr: string; en: string }) =>
        words(c.en).length > 0 &&
        !nearlyEqual(c.en, answer) &&
        !linesShareMeaning(c.en, answer) &&
        !frLinesShareWords(c.fr, line.fr) &&
        !picked.some((p) => nearlyEqual(p.en, c.en) || linesShareMeaning(p.en, c.en) || frLinesShareWords(p.fr, c.fr));
      // First pass prefers similar lengths; the second takes anything that passes.
      for (const strict of [true, false]) {
        for (const pool of pools) {
          for (const c of pool) {
            if (picked.length >= CHOICES - 1) break;
            if ((!strict || lengthOk(answer, c.en)) && ok(c)) picked.push({ fr: c.fr, en: displayEn(c.en) });
          }
        }
        if (picked.length >= CHOICES - 1) break;
      }
      if (picked.length < CHOICES - 1) continue;
      const choices = r.shuffle([{ en: answer, correct: true }, ...picked.map((p) => ({ en: p.en, correct: false }))]);
      const key = line.units.filter((u) => u.key).map((u) => u.id);
      usedLineIds.add(line.id);
      return {
        id: `${scene.id}:listen-pick:${line.id}`,
        type: 'listen-pick',
        sceneId: scene.id,
        helpLineIds: [line.id],
        unitIds: key.length ? key : line.units.map((u) => u.id),
        lineId: line.id,
        choices,
      };
    }
    return null;
  },

  init(): ListenPickState {
    return { wrong: [], picked: null };
  },

  reduce(puzzle, state, action): ListenPickState {
    if (state.picked !== null || !action || action.kind !== 'pick') return state;
    const c = puzzle.choices[action.index];
    if (!c) return state;
    if (c.correct) return { ...state, picked: action.index };
    if (state.wrong.includes(action.index)) return state;
    return { ...state, wrong: [...state.wrong, action.index] };
  },

  isDone(_puzzle, state) {
    return state.picked !== null;
  },

  mistakes(_puzzle, state) {
    return state.wrong.length;
  },

  missedUnitIds(puzzle, state) {
    return state.wrong.length ? puzzle.unitIds : [];
  },

  solve(puzzle): ListenPickAction {
    return { kind: 'pick', index: puzzle.choices.findIndex((c) => c.correct) };
  },

  /** For the clumsy bot: a wrong choice not picked yet, or null when none is left. */
  wrongAction(puzzle: ListenPickPuzzle, state: ListenPickState, rng: Rng): ListenPickAction | null {
    if (state.picked !== null) return null;
    const left = puzzle.choices.map((c, i) => (c.correct || state.wrong.includes(i) ? -1 : i)).filter((i) => i >= 0);
    return left.length ? { kind: 'pick', index: rng.pick(left) } : null;
  },

  validate(puzzle: ListenPickPuzzle, scene: Scene): string[] {
    const p: string[] = [];
    const line = scene.lines.find((l) => l.id === puzzle.lineId);
    if (!line) return [`listen-pick: line ${puzzle.lineId} is not in the scene`];
    if (puzzle.choices.length !== CHOICES) p.push(`listen-pick: ${puzzle.choices.length} choices, expected ${CHOICES}`);
    const right = puzzle.choices.filter((c) => c.correct);
    if (right.length !== 1) p.push(`listen-pick: ${right.length} correct choices`);
    else if (normalizeEn(right[0]!.en) !== normalizeEn(line.en)) p.push('listen-pick: the correct choice is not the line\'s English');
    // No two choices nearly equal or saying mostly the same things; no wrong one translating a line of
    // the scene whose French is much like the line's.
    for (let i = 0; i < puzzle.choices.length; i++)
      for (let j = i + 1; j < puzzle.choices.length; j++) {
        const a = puzzle.choices[i]!.en;
        const b = puzzle.choices[j]!.en;
        if (nearlyEqual(a, b)) p.push(`listen-pick: choices ${i} and ${j} are nearly equal`);
        else if (linesShareMeaning(a, b)) p.push(`listen-pick: choices "${a}" and "${b}" say mostly the same things`);
      }
    const lookAlikes = scene.lines.filter((l) => l.id !== line.id && frLinesShareWords(l.fr, line.fr)).map((l) => normalizeEn(displayEn(l.en)));
    for (const c of puzzle.choices) {
      if (c.correct) continue;
      if (lookAlikes.includes(normalizeEn(c.en))) p.push(`listen-pick: wrong choice "${c.en}" is the English of a line whose French is much like it`);
    }
    if (!puzzle.helpLineIds.includes(line.id)) p.push('listen-pick: the line is not on the help strip');
    const ids = new Set(line.units.map((u) => u.id));
    for (const u of puzzle.unitIds) if (!ids.has(u)) p.push(`listen-pick: unit ${u} is not in the line`);
    if (line.endMs <= line.startMs || line.endMs > scene.audio.durationMs + 50) p.push('listen-pick: the line window is outside the audio');
    return p;
  },
};
