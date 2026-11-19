import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Line, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { playPuzzle } from '../practice/bot';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { frenchRelated } from './distinct';
import { blanksForLevel, fillBlanks, fits, freeWords, type FillBlanksPuzzle } from './fill-blanks';
import { foldFr } from './match';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, level: number, seed: number, extra: Partial<BuildCtx> = {}): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra };
}

/** A tiny hand-made scene with the edge cases: apostrophes, hyphens, one-letter words, accents, a repeated word. */
function handScene(): Scene {
  const fr = "Qu'est-ce que tu fais, là ? Non, non, à l'école !";
  const words = [
    ["Qu'est-ce que", 'what', true],
    ['tu', 'you', false],
    ['fais', 'do', true],
    ['là', 'there', true],
    ['Non', 'no', true],
    ['non', 'no', true],
    ['à', 'to', false],
    ["l'école", 'school', true],
  ] as const;
  let pos = 0;
  const units = words.map(([w, en, key], i) => {
    const cs = fr.indexOf(w, pos);
    pos = cs + w.length;
    return { id: `x-0001:${i + 1}`, kind: 'word' as const, fr: w, en, cs, ce: pos, startMs: 100 + i * 200, endMs: 280 + i * 200, key, words: [{ fr: w, cs, ce: pos, startMs: 100 + i * 200, endMs: 280 + i * 200 }] };
  });
  const line: Line = { id: 'x-0001', speaker: null, fr, en: 'What are you doing there? No, no, to school!', startMs: 100, endMs: 1800, units };
  return { ...FIXTURE_SCENE, id: 'x', lines: [line], notes: [], questions: [] };
}

describe('fill-blanks', () => {
  it('builds valid rounds on every real scene and level', () => {
    let built = 0;
    for (const scene of scenes)
      for (const level of [1, 2, 4, 6]) {
        const puzzle = fillBlanks.build(ctxFor(scene, level, 11, { others: scenes.slice(0, 1) })) as FillBlanksPuzzle | null;
        if (!puzzle) continue;
        built++;
        expect(fillBlanks.validate(puzzle, scene)).toEqual([]);
        expect(puzzle.blanks.length).toBeLessThanOrEqual(blanksForLevel(level));
        expect(playPuzzle(puzzle, fillBlanks, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, fillBlanks, { mode: 'clumsy', seed: 5 }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 4 * 0.95);
  });

  it('never offers a distractor sharing a French content word with a blank (docs/app-games.md, "Choices")', () => {
    for (const scene of scenes)
      for (const level of [1, 4, 6]) {
        const puzzle = fillBlanks.build(ctxFor(scene, level, level * 11)) as FillBlanksPuzzle | null;
        if (!puzzle) continue;
        const blanks = new Set(puzzle.blanks.map((b) => foldFr(b.fr)));
        const extra = puzzle.words.filter((x) => !blanks.has(foldFr(x.fr)));
        for (const [i, w] of extra.entries()) {
          for (const b of puzzle.blanks) expect(frenchRelated(w.fr, b.fr), `${puzzle.lineId}: "${w.fr}" / "${b.fr}"`).toBe(false);
          for (const x of extra.slice(i + 1)) expect(frenchRelated(w.fr, x.fr), `${puzzle.lineId}: "${w.fr}" / "${x.fr}"`).toBe(false);
        }
      }
  });

  bundleIt('blanks more with the level and the weak units first', () => {
    const scene = scenes.find((s) => s.lines.some((l) => l.units.filter((u) => u.key).length >= 5))!;
    const counts = [1, 2, 3, 4, 5, 6].map((level) => fillBlanks.build(ctxFor(scene, level, 3))!.blanks.length);
    expect(counts[5]).toBeGreaterThan(counts[0]!);
    const t0 = fillBlanks.build(ctxFor(scene, 1, 3))!;
    const line = scene.lines.find((l) => l.id === t0.lineId)!;
    const other = line.units.find((u) => u.key && !t0.blanks.some((b) => b.unitId === u.id));
    if (other) {
      const t1 = fillBlanks.build(ctxFor(scene, 1, 3, { focusUnitIds: new Set([other.id]) }))!;
      expect(t1.blanks.map((b) => b.unitId)).toContain(other.id);
    }
  });

  it('handles apostrophes, one-letter words, accents and repeated words', () => {
    const scene = handScene();
    for (const level of [1, 3, 6])
      for (const seed of [1, 2, 3, 4]) {
        const puzzle = fillBlanks.build(ctxFor(scene, level, seed))!;
        expect(puzzle).not.toBeNull();
        expect(fillBlanks.validate(puzzle, scene)).toEqual([]);
        // Never a one-letter non-key word ("à", "tu" are not key), never every unit.
        for (const b of puzzle.blanks) expect(['tu', 'à']).not.toContain(b.fr);
        // A distractor never equals any word of the line (accents ignored).
        const lineFolds = new Set(scene.lines[0]!.units.map((u) => foldFr(u.fr)));
        const blankFolds = new Set(puzzle.blanks.map((b) => foldFr(b.fr)));
        for (const w of puzzle.words) if (!blankFolds.has(foldFr(w.fr))) expect(lineFolds.has(foldFr(w.fr))).toBe(false);
        expect(playPuzzle(puzzle, fillBlanks, { mode: 'clumsy', seed }).problems).toEqual([]);
      }
  });

  it('treats equal words as interchangeable, and wrong words bounce', () => {
    const scene = handScene();
    const line = scene.lines[0]!;
    const puzzle: FillBlanksPuzzle = {
      id: 't', type: 'fill-blanks', sceneId: 'x', helpLineIds: [line.id], unitIds: ['x-0001:5', 'x-0001:6'], lineId: line.id,
      blanks: [{ unitId: 'x-0001:5', fr: 'Non' }, { unitId: 'x-0001:6', fr: 'non' }],
      words: [{ fr: 'non' }, { fr: 'chat' }, { fr: 'Non' }],
    };
    expect(fillBlanks.validate(puzzle, scene)).toEqual([]);
    expect(fits(puzzle, 0, 0)).toBe(true);
    let st = fillBlanks.init(puzzle);
    st = fillBlanks.reduce(puzzle, st, { kind: 'place', blank: 0, word: 1 });
    st = fillBlanks.reduce(puzzle, st, { kind: 'place', blank: 0, word: 1 });
    expect(st.wrong[0]).toBe(2);
    expect(st.filled[0]).toBeNull();
    st = fillBlanks.reduce(puzzle, st, { kind: 'place', blank: 0, word: 0 });
    expect(freeWords(puzzle, st)).toEqual([1, 2]);
    // The same word cannot go in twice.
    expect(fillBlanks.reduce(puzzle, st, { kind: 'place', blank: 1, word: 0 })).toBe(st);
    st = fillBlanks.reduce(puzzle, st, { kind: 'place', blank: 1, word: 2 });
    expect(fillBlanks.isDone(puzzle, st)).toBe(true);
    expect(fillBlanks.mistakes(puzzle, st)).toBe(2);
    expect(fillBlanks.missedUnitIds(puzzle, st)).toEqual(['x-0001:5']);
  });

  it('validate catches unfair banks', () => {
    const scene = handScene();
    const puzzle = fillBlanks.build(ctxFor(scene, 4, 1))!;
    const b0 = puzzle.blanks[0]!;
    expect(fillBlanks.validate({ ...puzzle, words: [...puzzle.words, { fr: b0.fr.toUpperCase() }] }, scene).join()).toMatch(/bank has/);
    expect(fillBlanks.validate({ ...puzzle, words: puzzle.words.filter((w) => foldFr(w.fr) !== foldFr(b0.fr)) }, scene).join()).toMatch(/bank has 0/);
    expect(fillBlanks.validate({ ...puzzle, words: [...puzzle.words, { fr: 'tu' }] }, scene).join()).toMatch(/visible word/);
    expect(fillBlanks.validate({ ...puzzle, blanks: [...puzzle.blanks].reverse() }, scene).join()).toMatch(puzzle.blanks.length > 1 ? /order/ : /^$/);
    expect(fillBlanks.validate({ ...puzzle, helpLineIds: [] }, scene).join()).toMatch(/help strip/);
  });
});
