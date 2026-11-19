// Helpers shared by the arcade puzzle types (rebuild, comic-order, catapult, vrai-faux, memory): picking
// units and lines the way every puzzle type should (the kid's weak units first, lines not used yet in the
// practice last), wrong choices never close in meaning to the right one (docs/app-games.md, "Choices"),
// and French text comparison. Pure: no DOM.

import type { Line, Scene, Unit } from '../content';
import type { Rng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { frenchRelated, linesShareMeaning, sharedEnWords } from './distinct';
import { displayEn, nearlyEqual, normalizeEn } from './listen-pick';

export { displayEn, nearlyEqual, normalizeEn };
export { frenchRelated, linesShareMeaning, sharedEnWords };

/**
 * Two short glosses too close in meaning to offer one as a wrong choice for the other: nearly equal,
 * or sharing an English content word ("a world" / "in this world"; plural and inflected forms count
 * as the same word, articles, prepositions, pronouns and other function words do not).
 */
export function closeInMeaning(a: string, b: string): boolean {
  return nearlyEqual(a, b) || sharedEnWords(a, b).length > 0;
}

/** Two whole lines of English too close to offer one as a wrong choice for the other (docs/app-games.md, "Choices"). */
export function linesCloseInMeaning(a: string, b: string): boolean {
  return linesConfusable(a, b) || linesShareMeaning(a, b);
}

/** French compared for "the same tile": lower case, no punctuation or dashes, apostrophes unified. */
export function normalizeFr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function enWords(s: string): number {
  return normalizeEn(s).split(' ').filter(Boolean).length;
}

export interface UnitRef {
  line: Line;
  unit: Unit;
}

/**
 * Key units usable as a "what does this mean" item: they carry English that is not just the French
 * again (a name like "Suffix" glossed "Suffix" teaches nothing) and that is short enough for a sign.
 */
export function meaningUnits(scene: Scene): UnitRef[] {
  const out: UnitRef[] = [];
  for (const line of scene.lines) {
    for (const unit of line.units) {
      if (!unit.key) continue;
      const en = normalizeEn(unit.en);
      if (!en || en === normalizeEn(unit.fr) || normalizeFr(unit.fr) === normalizeFr(unit.en)) continue;
      if (unit.en.length > 48 || !normalizeFr(unit.fr)) continue;
      if (unit.endMs <= unit.startMs) continue;
      out.push({ line, unit });
    }
  }
  return out;
}

/**
 * The meaning units a build may use: all of the scene's, or, for a targeted build
 * (BuildCtx.targetLineId), only that line's, and only `targetUnitIds` when given.
 */
export function candidateUnits(ctx: BuildCtx): UnitRef[] {
  let refs = meaningUnits(ctx.scene);
  if (ctx.targetLineId) refs = refs.filter((r) => r.line.id === ctx.targetLineId);
  if (ctx.targetUnitIds?.length) {
    const want = new Set(ctx.targetUnitIds);
    refs = refs.filter((r) => want.has(r.unit.id));
  }
  return refs;
}

/**
 * Orders candidate units: the kid's weak units first, then units whose line and unit are unused in
 * this practice, exact-timed lines before estimated ones, random within. Used units come last whatever
 * their score.
 */
export function rankUnits(refs: UnitRef[], ctx: BuildCtx, rng: Rng): UnitRef[] {
  const scored = refs.map((r) => ({
    r,
    used: ctx.usedUnitIds.has(r.unit.id) || ctx.usedLineIds.has(r.line.id),
    score: (ctx.focusUnitIds.has(r.unit.id) ? 4 : 0) + (r.line.approxTimes ? 0 : 1.5) + rng.next() * 2,
  }));
  scored.sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score);
  return scored.map((s) => s.r);
}

/**
 * Picks up to n units with pairwise distinct French and pairwise distinguishable English. With
 * `apart` (memory, where every English shield is a wrong choice for every other French one) no two
 * share a content word either, in French or in English.
 */
export function pickDistinctUnits(ranked: UnitRef[], n: number, opts: { apart?: boolean } = {}): UnitRef[] {
  const out: UnitRef[] = [];
  for (const r of ranked) {
    if (out.length >= n) break;
    const fr = normalizeFr(r.unit.fr);
    if (out.some((o) => normalizeFr(o.unit.fr) === fr || nearlyEqual(o.unit.en, r.unit.en))) continue;
    if (opts.apart && out.some((o) => closeInMeaning(o.unit.en, r.unit.en) || frenchRelated(o.unit.fr, r.unit.fr))) continue;
    out.push(r);
  }
  return out;
}

/** A unit's French and English, as a candidate wrong choice. */
export interface Gloss {
  fr: string;
  en: string;
}

/** The glosses of units, from this scene, then the practice's other scenes, then the bank. */
export function unitGlossPools(ctx: BuildCtx, rng: Rng): Gloss[][] {
  const g = (u: { fr: string; en: string }): Gloss => ({ fr: u.fr, en: u.en });
  return [
    rng.shuffle(meaningUnits(ctx.scene).map((r) => g(r.unit))),
    rng.shuffle(ctx.others.flatMap((o) => meaningUnits(o).map((r) => g(r.unit)))),
    rng.shuffle(ctx.bank.units.map(g)),
  ];
}

/**
 * n English distractors for `answer` (a unit's French and English), the rule of docs/app-games.md,
 * "Choices": never close in meaning to the answer (`closeInMeaning`), never from French related to
 * the answer's (`frenchRelated`: a shared content word, so never the English of the same French or of
 * a unit containing it), never close to anything in `avoid` (glosses that would also be right, e.g.
 * of a unit of the scene with related French: `relatedGlosses`), and never close to each other by the
 * same rule (two wrong signs "a world" and "in this world" confuse too). The first pass keeps lengths
 * close to the answer's; the second takes anything that passes.
 */
export function pickDistractors(answer: Gloss, pools: Gloss[][], n: number, avoid: string[] = []): string[] {
  const picked: Gloss[] = [];
  const a = answer.en.length;
  const ok = (c: Gloss) =>
    enWords(c.en) > 0 &&
    c.en.length <= 48 &&
    !closeInMeaning(c.en, answer.en) &&
    !frenchRelated(c.fr, answer.fr) &&
    !avoid.some((x) => closeInMeaning(x, c.en)) &&
    !picked.some((p) => closeInMeaning(p.en, c.en) || frenchRelated(p.fr, c.fr));
  const out = () => picked.map((p) => p.en.trim());
  for (const strict of [true, false]) {
    for (const pool of pools) {
      for (const c of pool) {
        if (picked.length >= n) return out();
        if (strict && (c.en.length < a / 2.5 || c.en.length > a * 2.5 + 6)) continue;
        if (ok(c)) picked.push(c);
      }
    }
  }
  return out();
}

/** English glosses of units of the scene that share this French (they are right answers too). */
export function sameFrenchGlosses(scene: Scene, unit: Unit): string[] {
  const fr = normalizeFr(unit.fr);
  return scene.lines.flatMap((l) => l.units.filter((u) => u.id !== unit.id && normalizeFr(u.fr) === fr).map((u) => u.en));
}

/**
 * English glosses of the scene's other units whose French is related to this unit's (the same
 * French, French containing it, or sharing a content word): heard as a fragment, the unit could be
 * taken for any of them, so a wrong choice must not be close to these either.
 */
export function relatedGlosses(scene: Scene, unit: Unit): string[] {
  return scene.lines.flatMap((l) => l.units.filter((u) => u.id !== unit.id && frenchRelated(u.fr, unit.fr)).map((u) => u.en));
}

/**
 * Problems with a set of English choices: exactly one right, the right one being `answer`, no two
 * close in meaning (nearly equal or sharing a content word), no wrong one close to `related`
 * (`relatedGlosses`).
 */
export function checkChoices(puzzleType: string, where: string, choices: { en: string; correct: boolean }[], answer: string, related: string[] = []): string[] {
  const p: string[] = [];
  const right = choices.filter((c) => c.correct);
  if (right.length !== 1) p.push(`${puzzleType}: ${where}: ${right.length} correct choices`);
  else if (normalizeEn(right[0]!.en) !== normalizeEn(answer)) p.push(`${puzzleType}: ${where}: the correct choice is not the unit's English`);
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]!;
    if (!normalizeEn(c.en)) p.push(`${puzzleType}: ${where}: choice ${i} is empty`);
    for (let j = i + 1; j < choices.length; j++) {
      const d = choices[j]!;
      if (nearlyEqual(c.en, d.en)) p.push(`${puzzleType}: ${where}: choices ${i} and ${j} are nearly equal`);
      else if (closeInMeaning(c.en, d.en)) p.push(`${puzzleType}: ${where}: choices "${c.en}" and "${d.en}" are close in meaning`);
    }
    if (c.correct) continue;
    const near = related.find((g) => closeInMeaning(g, c.en));
    if (near !== undefined) p.push(`${puzzleType}: ${where}: wrong choice "${c.en}" is close to "${near}", the English of related French`);
  }
  return p;
}

/** Finds a unit of the scene by id. */
export function unitRef(scene: Scene, unitId: string): UnitRef | undefined {
  const lineId = unitId.slice(0, unitId.lastIndexOf(':'));
  const line = scene.lines.find((l) => l.id === lineId);
  const unit = line?.units.find((u) => u.id === unitId);
  return line && unit ? { line, unit } : undefined;
}

/** Common checks: the lines a puzzle uses are on its help strip, its units exist in those lines. */
export function checkHelp(puzzleType: string, scene: Scene, helpLineIds: string[], usedLineIds: string[], unitIds: string[]): string[] {
  const p: string[] = [];
  for (const id of usedLineIds) if (!helpLineIds.includes(id)) p.push(`${puzzleType}: line ${id} is not on the help strip`);
  for (const u of unitIds) {
    const r = unitRef(scene, u);
    if (!r) p.push(`${puzzleType}: unit ${u} is not in the scene`);
    else if (!helpLineIds.includes(r.line.id)) p.push(`${puzzleType}: unit ${u} is not on the help strip`);
  }
  return p;
}

/** A shuffle that never returns the input order (when more than one element). */
export function shuffleNotIdentity<T>(items: readonly T[], rng: Rng): T[] {
  if (items.length < 2) return items.slice();
  for (let k = 0; k < 8; k++) {
    const s = rng.shuffle(items);
    if (s.some((x, i) => x !== items[i])) return s;
  }
  const s = items.slice();
  s.push(s.shift()!);
  return s;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

// ---- lines (the cross-line puzzles) ----------------------------------------------------------

/** A line a cross-line puzzle can show: some French, some English, long enough to hear. */
export function usableLine(line: Line): boolean {
  return line.endMs - line.startMs >= 400 && enWords(line.en) > 0 && normalizeFr(line.fr).length > 0 && line.units.length > 0;
}

function wordSet(s: string): Set<string> {
  return new Set(normalizeEn(s).split(' ').filter(Boolean));
}

/**
 * Two whole lines (French or English) too close to tell apart: equal once normalised, mostly the
 * same words, or one inside the other when the shorter is most of the longer. Looser than
 * `nearlyEqual` (made for short glosses): song verses often start alike ("We feel good, ...").
 */
export function linesConfusable(a: string, b: string): boolean {
  const na = normalizeEn(a);
  const nb = normalizeEn(b);
  if (!na || !nb || na === nb) return true;
  const sa = wordSet(a);
  const sb = wordSet(b);
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  if (common / (sa.size + sb.size - common) >= 0.75) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (long.includes(short) && short.split(' ').length >= 0.6 * long.split(' ').length) return true;
  return false;
}

/** The lines of the scene by id, in scene order. */
export function linesById(scene: Scene, ids: readonly string[]): Line[] {
  return ids.map((id) => scene.lines.find((l) => l.id === id)).filter((l): l is Line => !!l);
}
