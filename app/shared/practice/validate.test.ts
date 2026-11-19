import { describe, expect, it } from 'vitest';
import { FIXTURE_SCENE } from '../fixtures';
import { watch } from '../puzzles/watch';
import { playPractice, playPuzzle } from './bot';
import { fakePuzzleType } from './testing';
import type { AnyPuzzleType, Practice, PuzzleBase } from './types';
import { validatePractice } from './validate';

const S = FIXTURE_SCENE;
const pick = fakePuzzleType('pick', 'recognise');
const say = fakePuzzleType('say', 'produce', { needsMic: true });
const PUZZLE_TYPES: AnyPuzzleType[] = [watch, pick, say];

const watchPuzzle: PuzzleBase = { id: 'a', type: 'watch', sceneId: S.id, helpLineIds: S.lines.map((l) => l.id), unitIds: [] };
const pickPuzzle = (over: Partial<PuzzleBase & { items: string[] }> = {}) => ({
  id: 'b', type: 'pick', sceneId: S.id, helpLineIds: ['s01e04-0017'], unitIds: ['s01e04-0017:1'], items: ['s01e04-0017:1'], ...over,
});
const practice = (puzzles: PuzzleBase[], level = 1): Practice => ({
  id: 'L', seed: 1, kind: 'scene', entries: [{ sceneId: S.id, level, due: true }], puzzles,
});
const messages = (l: Practice, speak?: boolean) => validatePractice(l, [S], { puzzleTypes: PUZZLE_TYPES, speak }).map((p) => p.message);

describe('validatePractice', () => {
  it('accepts a sound practice', () => {
    expect(messages(practice([watchPuzzle, pickPuzzle()]), true)).toEqual([]);
  });

  it('catches a unit that is not on the help strip', () => {
    const m = messages(practice([watchPuzzle, pickPuzzle({ helpLineIds: ['s01e04-0016'] })]));
    expect(m.some((x) => x.includes('not on the help strip'))).toBe(true);
  });

  it('catches unknown ids, duplicate puzzle ids, foreign scenes and empty practices', () => {
    expect(messages(practice([watchPuzzle, pickPuzzle({ unitIds: ['nope:1'] })])).join()).toContain('unit nope:1 is not in the scene');
    expect(messages(practice([watchPuzzle, pickPuzzle({ helpLineIds: ['x'] })])).join()).toContain('help line x');
    expect(messages(practice([watchPuzzle, pickPuzzle({ id: 'a' })])).join()).toContain('used twice');
    expect(messages(practice([watchPuzzle, pickPuzzle({ sceneId: 'other' })])).join()).toContain('not in the practice');
    expect(messages(practice([])).join()).toContain('no puzzles');
    expect(messages(practice([watchPuzzle, { ...pickPuzzle(), type: 'ghost' }])).join()).toContain('no puzzle type is registered');
  });

  it('checks the policy: intro first, no mic with speak off, a puzzle besides watching', () => {
    expect(messages(practice([pickPuzzle(), watchPuzzle])).join()).toContain('must start with its intro');
    const sayPuzzle = { ...pickPuzzle(), id: 'c', type: 'say' };
    expect(messages(practice([watchPuzzle, sayPuzzle]), false).join()).toContain('needs the microphone');
    expect(messages(practice([watchPuzzle]), true).join()).toContain('no puzzle besides watching');
    expect(messages(practice([pickPuzzle()], 4), true)).toEqual([]);
  });

  it("runs the puzzle type's own validate", () => {
    expect(messages(practice([watchPuzzle, pickPuzzle({ items: [] })])).join()).toContain('no items');
  });
});

describe('bots', () => {
  it('finish a sound practice with both bots', () => {
    const l = practice([watchPuzzle, pickPuzzle()]);
    expect(playPractice(l, [S], { puzzleTypes: PUZZLE_TYPES })).toEqual([]);
    expect(playPractice(l, [S], { puzzleTypes: PUZZLE_TYPES, mode: 'clumsy' })).toEqual([]);
    const { run } = playPuzzle(pickPuzzle(), pick, { mode: 'clumsy' });
    expect(run.wrongMoves).toBeGreaterThanOrEqual(2);
    expect(run.mistakes).toBe(run.wrongMoves);
  });

  it('fail a puzzle that never finishes', () => {
    const stuck: AnyPuzzleType = { ...pick, reduce: (_t: unknown, s: unknown) => s };
    expect(playPuzzle(pickPuzzle(), stuck).problems.join()).toContain('did not finish');
  });

  it('fail a perfect player who makes mistakes, and a throwing solve', () => {
    const sloppy: AnyPuzzleType = { ...pick, mistakes: () => 1 };
    expect(playPuzzle(pickPuzzle(), sloppy).problems.join()).toContain('perfect player ended with 1 mistakes');
    const broken: AnyPuzzleType = { ...pick, solve: () => { throw new Error('no idea'); } };
    expect(playPuzzle(pickPuzzle(), broken).problems.join()).toContain('solve threw: no idea');
  });

  it('fail a wrong move that ends the puzzle or counts no mistake', () => {
    const ends = { ...pick, wrongAction: () => ({ pick: 's01e04-0017:1' }) } as AnyPuzzleType;
    expect(playPuzzle(pickPuzzle(), ends, { mode: 'clumsy' }).problems.join()).toContain('a wrong move finished the puzzle');
    const free: AnyPuzzleType = { ...pick, reduce: (t: any, s: any, a: any) => (a.pick === 'nope' ? s : pick.reduce(t, s, a)) };
    expect(playPuzzle(pickPuzzle(), free, { mode: 'clumsy' }).problems.join()).toContain('did not count a mistake');
  });

  it('fail a reducer that mutates its state', () => {
    const mutating: AnyPuzzleType = { ...pick, reduce: (_t: any, s: any) => { s.next++; return s; } };
    expect(playPuzzle(pickPuzzle(), mutating).problems.join()).toContain('must be pure');
  });

  it('skip wrong moves for a puzzle type without wrongAction', () => {
    const { run, problems } = playPuzzle(watchPuzzle, watch, { mode: 'clumsy' });
    expect(problems).toEqual([]);
    expect(run.hasWrongAction).toBe(false);
  });
});
