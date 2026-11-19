// Tests of the microphone puzzle types act-line, say-chain and say-choice.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { playPuzzle } from '../practice/bot';
import { composePractice } from '../practice/practice';
import { validatePractice } from '../practice/validate';
import { allPuzzleTypes } from '../practice/registry';
import { replaceMicPuzzle } from '../practice/replace';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { SPEECH_MAX_TRIES } from '../rules';
import './index';
import { actLine, type ActLinePuzzle } from './act-line';
import { sayChain, CHAIN_MIN, type SayChainPuzzle } from './say-chain';
import { alternatesOf, canTap, sayChoice, type SayChoicePuzzle } from './say-choice';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, level: number, seed: number, extra: Partial<BuildCtx> = {}): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra };
}

/** A scene whose lines carry two alternates each (as the export will write for the Panono scene). */
function withAlternates(scene: Scene): Scene {
  return {
    ...scene,
    lines: scene.lines.map((l, i) => ({
      ...l,
      alternates: [
        { fr: `Madame Banane, tout va mal ${i}`, en: `Mrs Banana, all is wrong ${i}`, units: [{ fr: 'Madame Banane', en: 'Mrs Banana', cs: 0, ce: 13 }, { fr: `tout va mal ${i}`, en: 'all is wrong', cs: 15, ce: 26 + String(i).length }] },
        { fr: `Monsieur Caillou, ça chatouille ${i}`, en: `Mr Pebble, it tickles ${i}`, units: [{ fr: `Monsieur Caillou, ça chatouille ${i}`, en: 'Mr Pebble, it tickles', cs: 0, ce: 31 + String(i).length }] },
      ],
    })) as Scene['lines'],
  };
}

const panono = scenes.find((s) => s.id === 's01e03-0023-0026') ?? scenes[0]!;

describe('act-line', () => {
  it('builds a valid, playable puzzle with its neighbours for every scene of two lines or more', () => {
    let built = 0;
    for (const scene of scenes)
      for (const seed of [1, 2]) {
        const puzzle = actLine.build(ctxFor(scene, 2, seed)) as ActLinePuzzle | null;
        if (scene.lines.length < 2) {
          expect(puzzle).toBeNull();
          continue;
        }
        if (!puzzle) continue;
        built++;
        expect(actLine.validate(puzzle, scene)).toEqual([]);
        expect(puzzle.beforeIds.length + (puzzle.afterId ? 1 : 0)).toBeGreaterThan(0);
        expect(playPuzzle(puzzle, actLine, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, actLine, { mode: 'clumsy', seed }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 2 * 0.95);
  });

  bundleIt('honours targetLineId, including the first and the last line', () => {
    const first = actLine.build(ctxFor(panono, 1, 1, { targetLineId: panono.lines[0]!.id }))!;
    expect(first.beforeIds).toEqual([]);
    expect(first.afterId).toBe(panono.lines[1]!.id);
    const lastLine = panono.lines.filter((l) => l.fr.split(/\s+/).length >= 2).at(-1)!;
    const last = actLine.build(ctxFor(panono, 1, 1, { targetLineId: lastLine.id }));
    if (last && lastLine === panono.lines.at(-1)) expect(last.afterId).toBeNull();
    expect(actLine.validate({ ...first, beforeIds: [panono.lines[2]!.id] }, panono).join()).toMatch(/before/);
  });

  it('accumulates heard words across tries, and the third try passes', () => {
    const puzzle = actLine.build(ctxFor(panono, 1, 1, { targetLineId: panono.lines[0]!.id }))!;
    const words = puzzle.text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
    let st = actLine.init(puzzle);
    st = actLine.reduce(puzzle, st, { kind: 'verdict', pass: false, score: 0.3, matched: words.map((word, i) => ({ word, ok: i < 3 })) });
    st = actLine.reduce(puzzle, st, { kind: 'verdict', pass: false, score: 0.3, matched: words.map((word, i) => ({ word, ok: i >= 3 })) });
    expect(st.done).toBe('passed'); // every word heard over two tries
    expect(st.auto).toBe(false);
    let st2 = actLine.init(puzzle);
    for (let i = 0; i < SPEECH_MAX_TRIES; i++) st2 = actLine.reduce(puzzle, st2, actLine.wrongAction!(puzzle, st2, createRng(1)) ?? { kind: 'verdict', pass: false, score: 0, matched: [] });
    expect(st2.done).toBe('passed');
    expect(st2.auto).toBe(true);
  });
});

describe('say-chain', () => {
  it('builds chains of 4-6 distinct units on most scenes, playable by both bots', () => {
    let built = 0;
    for (const scene of scenes)
      for (const level of [1, 4]) {
        const puzzle = sayChain.build(ctxFor(scene, level, 3)) as SayChainPuzzle | null;
        if (!puzzle) continue;
        built++;
        expect(sayChain.validate(puzzle, scene)).toEqual([]);
        expect(puzzle.items.length).toBeGreaterThanOrEqual(CHAIN_MIN);
        expect(playPuzzle(puzzle, sayChain, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, sayChain, { mode: 'clumsy', seed: 2 }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 2 * 0.85);
  });

  it('moves on by itself: heard, or the third try', () => {
    const scene = scenes.find((s) => sayChain.build(ctxFor(s, 1, 1)) !== null)!;
    const puzzle = sayChain.build(ctxFor(scene, 1, 1))!;
    let st = sayChain.init(puzzle);
    st = sayChain.reduce(puzzle, st, sayChain.solve(puzzle, st));
    expect(st.index).toBe(1);
    expect(st.results[0]).toEqual({ how: 'heard', tries: 1 });
    const missed = { kind: 'verdict' as const, pass: false, score: 0, matched: [] };
    st = sayChain.reduce(puzzle, st, missed);
    st = sayChain.reduce(puzzle, st, missed);
    expect(st.index).toBe(1);
    expect(sayChain.wrongAction!(puzzle, st, createRng(1))).toBeNull(); // the next try would move on
    st = sayChain.reduce(puzzle, st, missed);
    expect(st.index).toBe(2);
    expect(st.results[1]).toEqual({ how: 'auto', tries: 3 });
    expect(st.mistakes).toBe(2);
    st = sayChain.reduce(puzzle, st, { kind: 'unavailable' });
    st = sayChain.reduce(puzzle, st, { kind: 'next' });
    expect(st.results[2]!.how).toBe('listened');
    expect(sayChain.missedUnitIds(puzzle, st)).toEqual([puzzle.items[1]!.unitId]);
    // A slow server: the item counts as done, the chain goes on.
    let s2 = sayChain.init(puzzle);
    s2 = sayChain.reduce(puzzle, s2, { kind: 'timeout' });
    expect(s2.index).toBe(1);
    expect(s2.results[0]!.how).toBe('auto');
  });

  it('scores again when the server answers after a 503 (a verdict or a timeout in listen-back mode)', () => {
    const scene = scenes.find((s) => sayChain.build(ctxFor(s, 1, 1)) !== null)!;
    const puzzle = sayChain.build(ctxFor(scene, 1, 1))!;
    let st = sayChain.reduce(puzzle, sayChain.init(puzzle), { kind: 'unavailable' });
    st = sayChain.reduce(puzzle, st, { kind: 'next' });
    expect(st.mode).toBe('listen-back');
    st = sayChain.reduce(puzzle, st, sayChain.solve(puzzle, st)); // the server is back
    expect(st.index).toBe(2);
    expect(st.mode).toBe('speak');
    expect(st.results[1]!.how).toBe('heard');
    st = sayChain.reduce(puzzle, st, { kind: 'unavailable' });
    st = sayChain.reduce(puzzle, st, { kind: 'timeout' }); // a slow answer on the next take
    expect(st.index).toBe(3);
    expect(sayChain.reduce(puzzle, st, { kind: 'next' })).toBe(st); // no stray `next` in speak mode
  });

  it('puts targetUnitIds first', () => {
    const t0 = sayChain.build(ctxFor(panono, 1, 1));
    if (!t0) return;
    const last = t0.items.at(-1)!.unitId;
    const t1 = sayChain.build(ctxFor(panono, 1, 9, { targetUnitIds: [last] }))!;
    expect(t1.unitIds).toContain(last);
  });
});

describe('say-choice', () => {
  const scene = withAlternates(panono);

  bundleIt('builds valid, playable puzzles on every release scene with real alternates', () => {
    let built = 0;
    for (const sc of scenes)
      for (const seed of [1, 2]) {
        const puzzle = sayChoice.build(ctxFor(sc, 2, seed));
        if (!puzzle) continue;
        built++;
        expect(sayChoice.validate(puzzle, sc), `${sc.id}`).toEqual([]);
        expect(playPuzzle(puzzle, sayChoice, { mode: 'perfect' }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(0);
  });

  bundleIt('returns null for lines without alternates, builds three options otherwise', () => {
    // Every release line has alternates now: strip them for the "none yet" case, and keep one only.
    const plain = { ...panono, lines: panono.lines.map((l) => ({ ...l, alternates: undefined })) } as Scene;
    expect(sayChoice.build(ctxFor(plain, 1, 1))).toBeNull();
    const one = { ...panono, lines: panono.lines.map((l) => ({ ...l, alternates: alternatesOf(l).slice(0, 1) })) } as Scene;
    expect(sayChoice.build(ctxFor(one, 1, 1))).toBeNull();
    for (const seed of [1, 2, 3, 4]) {
      const puzzle = sayChoice.build(ctxFor(scene, 1, seed)) as SayChoicePuzzle;
      expect(sayChoice.validate(puzzle, scene)).toEqual([]);
      expect(puzzle.options.map((o) => o.k).sort()).toEqual([0, 1, 2]);
      expect(playPuzzle(puzzle, sayChoice, { mode: 'perfect' }).problems).toEqual([]);
      expect(playPuzzle(puzzle, sayChoice, { mode: 'clumsy', seed }).problems).toEqual([]);
    }
    const target = scene.lines[2]!.id;
    expect(sayChoice.build(ctxFor(scene, 1, 1, { targetLineId: target }))!.lineId).toBe(target);
  });

  it('has no wrong choice: unrecognised tries, then a tap or the closest wins', () => {
    const puzzle = sayChoice.build(ctxFor(scene, 1, 1))!;
    let st = sayChoice.init(puzzle);
    expect(canTap(st)).toBe(false);
    st = sayChoice.reduce(puzzle, st, { kind: 'said', index: null, closest: 2 });
    expect(st.chosen).toBeNull();
    expect(canTap(st)).toBe(true);
    const tapped = sayChoice.reduce(puzzle, st, { kind: 'tap', k: 1 });
    expect(tapped.chosen).toBe(1);
    st = sayChoice.reduce(puzzle, st, { kind: 'said', index: null, closest: 2 });
    st = sayChoice.reduce(puzzle, st, { kind: 'said', index: null, closest: 2 });
    expect(st.chosen).toBe(2);
    expect(st.how).toBe('closest');
    expect(sayChoice.mistakes(puzzle, st)).toBe(0);
    expect(sayChoice.reduce(puzzle, sayChoice.init(puzzle), { kind: 'said', index: 1 }).chosen).toBe(1);
  });

  it('gives an alternate without pieces one piece for the whole sentence, and ignores empty ones', () => {
    const line = { ...panono.lines[0]!, alternates: [{ fr: 'Oh là là', en: 'Oh dear', units: [] }, { fr: ' ', en: 'x', units: [] }] };
    const alts = alternatesOf(line as never);
    expect(alts).toHaveLength(1);
    expect(alts[0]!.units).toEqual([{ fr: 'Oh là là', en: 'Oh dear', cs: 0, ce: 8 }]);
  });

  it('validate catches options that are not the line and its alternates', () => {
    const puzzle = sayChoice.build(ctxFor(scene, 1, 1))!;
    const bad = { ...puzzle, options: puzzle.options.map((o) => (o.k === 1 ? { ...o, fr: 'autre chose' } : o)) };
    expect(sayChoice.validate(bad, scene).join()).toMatch(/differs/);
  });
});

describe('the microphone puzzles in practices', () => {
  bundleIt('are picked by the practice composer, each with a tapping replacement, and the checks pass', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const practice = composePractice({ id: 'p', seed, scene: panono, level: 2, speak: true, bank });
      for (const t of practice.puzzles) {
        seen.add(t.type);
        if (['act-line', 'say-chain', 'say-choice'].includes(t.type)) expect(t.alt).toBeDefined();
      }
      expect(validatePractice(practice, [panono])).toEqual([]);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['act-line', 'say-chain', 'say-choice']));
  });

  it('each has a tapping replacement on the same French', () => {
    const scene = withAlternates(panono);
    for (const logic of [actLine, sayChain, sayChoice]) {
      const puzzle = logic.build(ctxFor(scene, 2, 2));
      if (!puzzle) continue;
      const r = replaceMicPuzzle(puzzle, scene, ctxFor(scene, 2, 3))!;
      expect(r.closeness).not.toBe('watch');
      expect(r.puzzle.helpLineIds.some((id) => puzzle.helpLineIds.includes(id))).toBe(true);
    }
  });
});
