import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { linesShareMeaning } from './distinct';
import { CHOICES, listenPick, nearlyEqual, normalizeEn, type ListenPickPuzzle } from './listen-pick';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle
  ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene)
  : [FIXTURE_SCENE];

function ctx(scene: Scene, seed: number, others: Scene[] = []): BuildCtx {
  return { scene, level: 1, rng: createRng(seed), focusUnitIds: new Set(), others, bank, usedLineIds: new Set(), usedUnitIds: new Set() };
}

describe('listen-pick', () => {
  it('compares glosses loosely', () => {
    expect(normalizeEn('- Is it you,\nDragibus?')).toBe('is it you dragibus');
    expect(nearlyEqual('No.', '- No!')).toBe(true);
    expect(nearlyEqual('No.', 'No, no.')).toBe(true);
    expect(nearlyEqual('Is it you, Dragibus?', 'Is it you, Lastofus?')).toBe(true); // same start: too close
    expect(nearlyEqual('Is it you, Dragibus?', 'You are Lastofus.')).toBe(false);
    expect(nearlyEqual('We will impose it on you', 'And if you do not like it')).toBe(false);
    expect(nearlyEqual("And if you don't like it", "And if you don't like it We will impose it on you")).toBe(true);
    expect(nearlyEqual('Is it you there?', 'Is it you, boar?')).toBe(true); // same start
  });

  it('gives the clumsy bot every wrong choice once, then none', () => {
    const puzzle = listenPick.build(ctx(FIXTURE_SCENE, 5)) as ListenPickPuzzle;
    const rng = createRng(9);
    let st = listenPick.init(puzzle);
    for (let i = 0; i < CHOICES - 1; i++) {
      const a = listenPick.wrongAction!(puzzle, st, rng)!;
      expect(puzzle.choices[a.index]!.correct).toBe(false);
      st = listenPick.reduce(puzzle, st, a);
      expect(listenPick.isDone(puzzle, st)).toBe(false);
    }
    expect(listenPick.mistakes(puzzle, st)).toBe(CHOICES - 1);
    expect(listenPick.wrongAction!(puzzle, st, rng)).toBeNull();
  });

  it('marks the line it picks as used', () => {
    const c = ctx(scenes[0]!, 4);
    const puzzle = listenPick.build(c)!;
    expect(c.usedLineIds.has(puzzle.lineId)).toBe(true);
  });

  it('builds a valid, solvable puzzle for every real scene', () => {
    let built = 0;
    for (const scene of scenes) {
      for (const seed of [1, 2, 3]) {
        const puzzle = listenPick.build(ctx(scene, seed, scenes.slice(0, 2).filter((s) => s.id !== scene.id)));
        if (!puzzle) continue;
        built++;
        expect(listenPick.validate(puzzle, scene), `${scene.id} seed ${seed}`).toEqual([]);
        expect(puzzle.choices).toHaveLength(CHOICES);
        let st = listenPick.init(puzzle);
        let steps = 0;
        while (!listenPick.isDone(puzzle, st) && steps++ < 10) st = listenPick.reduce(puzzle, st, listenPick.solve(puzzle, st));
        expect(listenPick.isDone(puzzle, st)).toBe(true);
        expect(listenPick.mistakes(puzzle, st)).toBe(0);
      }
    }
    expect(built).toBeGreaterThanOrEqual(scenes.length * 3 * 0.95);
  });

  it('never offers a wrong line that says mostly what the right one says (docs/app-games.md, "Choices")', () => {
    for (const scene of scenes)
      for (const line of scene.lines) {
        const puzzle = listenPick.build({ ...ctx(scene, 3), targetLineId: line.id }) as ListenPickPuzzle | null;
        if (!puzzle) continue;
        for (const [i, a] of puzzle.choices.entries())
          for (const b of puzzle.choices.slice(i + 1)) expect(linesShareMeaning(a.en, b.en), `${line.id}: "${a.en}" / "${b.en}"`).toBe(false);
        expect(listenPick.validate(puzzle, scene)).toEqual([]);
      }
    const bad = listenPick.build(ctx(FIXTURE_SCENE, 5)) as ListenPickPuzzle;
    const line = FIXTURE_SCENE.lines.find((l) => l.id === bad.lineId)!;
    const close = { ...bad, choices: bad.choices.map((c) => (c.correct ? c : { en: `${line.en.split('\n')[0]} and stop`, correct: false })) };
    expect(listenPick.validate(close, FIXTURE_SCENE).some((p) => p.includes('say mostly the same things') || p.includes('nearly equal'))).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = listenPick.build(ctx(scenes[0]!, 42));
    const b = listenPick.build(ctx(scenes[0]!, 42));
    expect(a).toEqual(b);
  });

  it('counts wrong picks once each, never fails, and finishes on the right pick', () => {
    const puzzle = listenPick.build(ctx(FIXTURE_SCENE, 7)) as ListenPickPuzzle;
    expect(puzzle).toBeTruthy();
    const right = puzzle.choices.findIndex((c) => c.correct);
    const wrongs = puzzle.choices.map((_, i) => i).filter((i) => i !== right);
    let st = listenPick.init(puzzle);
    st = listenPick.reduce(puzzle, st, { kind: 'pick', index: wrongs[0]! });
    st = listenPick.reduce(puzzle, st, { kind: 'pick', index: wrongs[0]! });
    st = listenPick.reduce(puzzle, st, { kind: 'pick', index: wrongs[1]! });
    expect(listenPick.isDone(puzzle, st)).toBe(false);
    expect(listenPick.mistakes(puzzle, st)).toBe(2);
    expect(listenPick.missedUnitIds(puzzle, st)).toEqual(puzzle.unitIds);
    st = listenPick.reduce(puzzle, st, { kind: 'pick', index: right });
    expect(listenPick.isDone(puzzle, st)).toBe(true);
    // Picks after the end change nothing.
    expect(listenPick.reduce(puzzle, st, { kind: 'pick', index: wrongs[2]! })).toBe(st);
  });

  bundleIt('prefers lines not used yet and the kid’s weak units', () => {
    const scene = scenes.find((s) => s.lines.length >= 5)!;
    const target = scene.lines[3]!;
    const c = ctx(scene, 3);
    c.focusUnitIds = new Set(target.units.map((u) => u.id));
    expect(listenPick.build(c)!.lineId).toBe(target.id);
    const c2 = ctx(scene, 3);
    for (const l of scene.lines.slice(1)) c2.usedLineIds.add(l.id);
    expect(listenPick.build(c2)!.lineId).toBe(scene.lines[0]!.id);
  });

  it('flags a broken puzzle', () => {
    const puzzle = listenPick.build(ctx(FIXTURE_SCENE, 1)) as ListenPickPuzzle;
    const bad: ListenPickPuzzle = { ...puzzle, choices: puzzle.choices.map((c) => ({ ...c, correct: true })) };
    expect(listenPick.validate(bad, FIXTURE_SCENE).length).toBeGreaterThan(0);
  });
});
