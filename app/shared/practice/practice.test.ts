import { describe, expect, it } from 'vitest';
import type { Line, Scene } from '../content';
import { FIXTURE_SCENE } from '../fixtures';
import { watch } from '../puzzles/watch';
import { playPractice } from './bot';
import {
  COMPOSER_VERSION,
  MIC_PER_WINDOW,
  MIC_WINDOW,
  PRACTICE_MAX,
  checkPracticePolicy,
  composePractice,
  micSpacingProblems,
  practiceReport,
  varietyBreaks,
  resumeIndex,
  type PracticeInput,
} from './practice';
import { fakePuzzleType } from './testing';
import type { AnyPuzzleType, PuzzleScope } from './types';
import { validatePractice } from './validate';

// A scene of n lines, each a copy of the fixture's lines under new ids.
function bigScene(n: number): Scene {
  const id = `s09e09-${String(n).padStart(4, '0')}-x`;
  const src = FIXTURE_SCENE.lines;
  const lines: Line[] = Array.from({ length: n }, (_, i) => {
    const base = src[i % src.length]!;
    const lid = `s09e09-${String(1000 + i)}`;
    return {
      ...base,
      id: lid,
      units: base.units.map((u, k) => ({ ...u, id: `${lid}:${k + 1}`, fr: u.fr, en: `${u.en} ${i}` })),
    };
  });
  return { ...FIXTURE_SCENE, id, lines, questions: [] };
}

const PUZZLE_TYPES: AnyPuzzleType[] = [
  watch,
  fakePuzzleType('pick', 'recognise', { scope: 'line' }),
  fakePuzzleType('ask', 'fun', { scope: 'line' }),
  fakePuzzleType('rebuild', 'recall', { scope: 'line' }),
  fakePuzzleType('blanks', 'recall', { scope: 'line' }),
  fakePuzzleType('match', 'recognise', { scope: 'unit', items: 3 }),
  fakePuzzleType('memory', 'fun', { scope: 'unit', items: 3 }),
  fakePuzzleType('comic', 'recall', { scope: 'multi-line', items: 3 }),
  fakePuzzleType('say', 'produce', { scope: 'line', needsMic: true }),
  fakePuzzleType('act', 'produce', { scope: 'long-line', needsMic: true }),
  fakePuzzleType('chain', 'produce', { scope: 'unit', needsMic: true, items: 3 }),
];
const mic = new Set(PUZZLE_TYPES.filter((g) => g.meta.needsMic).map((g) => g.type));

const input = (scene: Scene, over: Partial<PracticeInput> = {}): PracticeInput => ({
  id: 'P',
  seed: 3,
  scene,
  level: 1,
  speak: true,
  bank: { lines: [], units: [] },
  ...over,
});

describe('composePractice', () => {
  it('is deterministic and carries its composer version', () => {
    const s = bigScene(4);
    const a = composePractice(input(s), PUZZLE_TYPES);
    const b = composePractice(input(s), PUZZLE_TYPES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.composerVersion).toBe(COMPOSER_VERSION);
    expect(practiceReport(input(s), PUZZLE_TYPES)).toEqual(a.plan);
  });

  it('covers every line from several angles, mixed, within bounds, microphone puzzles spaced out', () => {
    for (const n of [4, 8, 12]) {
      for (const speak of [true, false]) {
        for (const level of [1, 4, 6]) {
          const s = bigScene(n);
          const p = composePractice(input(s, { speak, level, seed: n * 7 + level - 1 }), PUZZLE_TYPES);
          expect(p.problems).toEqual([]);
          expect(checkPracticePolicy(p, speak, PUZZLE_TYPES)).toEqual([]);
          expect(p.puzzles[0]!.type).toBe('watch');
          expect(p.puzzles.length).toBeLessThanOrEqual(PRACTICE_MAX);
          for (const c of p.plan.coverage) expect(c.angles).toBeGreaterThanOrEqual(3);
          for (let i = 1; i < p.puzzles.length; i++) expect(p.puzzles[i]!.type).not.toBe(p.puzzles[i - 1]!.type);
          expect(p.puzzles.some((t) => mic.has(t.type))).toBe(speak);
          if (speak) for (const t of mic) expect(p.puzzles.some((x) => x.type === t)).toBe(true);
          for (const sc of ['unit', 'line', 'multi-line', 'scene']) expect(p.plan.scopes[sc] ?? 0).toBeGreaterThan(0);
          const isMic = p.puzzles.map((t) => mic.has(t.type));
          for (let i = 0; i + MIC_WINDOW <= isMic.length; i++) expect(isMic.slice(i, i + MIC_WINDOW).filter(Boolean).length).toBeLessThanOrEqual(MIC_PER_WINDOW);
          for (let i = 1; i < isMic.length; i++) expect(isMic[i] && isMic[i - 1]).toBe(false);
          expect(validatePractice(p, [s], { speak, puzzleTypes: PUZZLE_TYPES })).toEqual([]);
          expect(playPractice(p, [s], { puzzleTypes: PUZZLE_TYPES })).toEqual([]);
          expect(playPractice(p, [s], { puzzleTypes: PUZZLE_TYPES, mode: 'clumsy' })).toEqual([]);
        }
      }
    }
  });

  it('grows with the scene: about 20 for four lines, up to the cap for a long one', () => {
    const four = composePractice(input(bigScene(4)), PUZZLE_TYPES).puzzles.length;
    const long = composePractice(input(bigScene(12)), PUZZLE_TYPES).puzzles.length;
    expect(four).toBeGreaterThanOrEqual(16);
    expect(four).toBeLessThanOrEqual(30);
    expect(long).toBeGreaterThan(four);
    expect(long).toBeLessThanOrEqual(PRACTICE_MAX);
  });

  it('asks each funny question at most once in a practice', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const level of [1, 3]) {
        for (const speak of [true, false]) {
          const p = composePractice(input(FIXTURE_SCENE, { seed, level, speak }));
          const asked = p.puzzles.map((x) => (x as { questionId?: string }).questionId).filter(Boolean);
          expect(asked.length).toBeGreaterThan(0);
          expect(new Set(asked).size).toBe(asked.length);
        }
      }
    }
  });

  it('ends shorter instead of repeating when few puzzle types can serve', () => {
    const few = [watch, fakePuzzleType('pick', 'recognise', { scope: 'line' })];
    const p = composePractice(input(bigScene(4)), few);
    expect(p.puzzles.length).toBeLessThan(12);
    expect(p.plan.coverage.every((c) => c.shortfall)).toBe(true);
  });

  it('states the microphone spacing rule', () => {
    const at = (...ix: number[]) => Array.from({ length: 20 }, (_, i) => ix.includes(i));
    expect(micSpacingProblems(at(0, 5, 10, 15))).toEqual([]);
    expect(micSpacingProblems(at(0, 2, 4))).toHaveLength(1); // three in ten
    expect(micSpacingProblems(at(3, 4))).toHaveLength(1); // two in a row
    expect(micSpacingProblems([])).toEqual([]);
  });

  it('states the variety rule: types, lines and units spaced out, relaxed for a scene of few lines', () => {
    const st = (index: number, type: string, lineIds: string[], scope: PuzzleScope = 'line', unitIds: string[] = []) => ({ index, type, angle: 'meaning' as const, scope, lineIds, unitIds });
    const ok = [st(1, 'a', ['L1']), st(2, 'b', ['L2']), st(3, 'c', ['L3']), st(4, 'a', ['L1']), st(5, 'm', ['L2', 'L3'], 'unit', ['L2:1', 'L3:1'])];
    expect(varietyBreaks(ok, 3)).toEqual([]);
    expect(varietyBreaks([st(1, 'a', ['L1']), st(2, 'b', ['L2']), st(3, 'a', ['L3'])], 3)).toEqual(['3 (a at 1)']);
    expect(varietyBreaks([st(1, 'a', ['L1']), st(2, 'b', ['L2']), st(3, 'c', ['L1'])], 3)).toEqual(['3 (line L1 at 1)']);
    expect(varietyBreaks([st(1, 'a', ['L1']), st(2, 'b', ['L2']), st(3, 'c', ['L1'])], 2)).toEqual([]); // two lines alternate
    const units = [st(1, 'm', ['L1', 'L2'], 'unit', ['L1:1', 'L2:1']), st(2, 'b', ['L3']), st(3, 'c', ['L2']), st(4, 'v', ['L1', 'L3'], 'unit', ['L1:1', 'L3:2'])];
    expect(varietyBreaks(units, 3)).toEqual(['4 (a unit of it at 1)']);
  });

  it('continues a practice by count, never past the last puzzle when the composition changed', () => {
    expect(resumeIndex(10, 30, true)).toBe(10);
    expect(resumeIndex(30, 30, true)).toBe(30); // all played: complete it
    expect(resumeIndex(30, 30, false)).toBe(29);
    expect(resumeIndex(40, 25, false)).toBe(24);
    expect(resumeIndex(0, 25, false)).toBe(0);
  });
});
