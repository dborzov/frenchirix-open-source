// Tests of the two speaking puzzle types (say-line, say-hidden) and their shared core.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { playPuzzle } from '../practice/bot';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { SPEECH_MAX_TRIES } from '../rules';
import { wordCount } from './match';
import { MASK_CHAR, maskFrench, sayHidden, type SayHiddenPuzzle } from './say-hidden';
import { frWords, preferredWordsForLevel, sayLine, type SayLinePuzzle } from './say-line';
import { canFail, frWordSpans, LISTEN_MAX_MS, recordLimitMs, spanCredit, speakInit, speakReduce } from './speak-core';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, level: number, seed: number, extra: Partial<BuildCtx> = {}): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra };
}

describe('speaking core', () => {
  it('counts failed tries, keeps what was heard lit, and lets the third try pass whatever came back', () => {
    let st = speakInit();
    const v = (ok: boolean[]) => ({ kind: 'verdict' as const, pass: false, score: 0.1, matched: ok.map((o, i) => ({ word: `w${i}`, ok: o })) });
    st = speakReduce(st, v([true, false, false]));
    expect(st.done).toBeNull();
    expect(canFail(st)).toBe(true);
    st = speakReduce(st, v([false, false, true]));
    expect(st.lit).toEqual([true, false, true]); // partial credit builds
    expect(st.mistakes).toBe(2);
    expect(canFail(st)).toBe(false); // the next try ends the round
    st = speakReduce(st, v([false, false, false]));
    expect(st.done).toBe('passed');
    expect(st.auto).toBe(true);
    expect(st.tries).toBe(SPEECH_MAX_TRIES);
    expect(st.mistakes).toBe(2);
  });

  it('passes once every word has been heard across tries', () => {
    let st = speakInit();
    st = speakReduce(st, { kind: 'verdict', pass: false, score: 0.4, matched: [{ word: 'a', ok: true }, { word: 'b', ok: false }] });
    st = speakReduce(st, { kind: 'verdict', pass: false, score: 0.4, matched: [{ word: 'a', ok: false }, { word: 'b', ok: true }] });
    expect(st.done).toBe('passed');
    expect(st.auto).toBe(false);
  });

  it('maps heard words to spans of the target', () => {
    const text = "Allez, chante avec tes copains";
    expect(frWordSpans(text).length).toBe(5);
    expect(spanCredit(text, [true, true, false, false, false], 0, 13)).toBe(1);
    expect(spanCredit(text, [true, true, true, false, false], 14, 30)).toBeCloseTo(1 / 3);
  });

  it('switches to listen-back when recognition is unavailable, with no mistake', () => {
    let st = speakInit();
    st = speakReduce(st, { kind: 'unavailable' });
    expect(st.mode).toBe('listen-back');
    // A late verdict does not count in listen-back.
    expect(speakReduce(st, { kind: 'verdict', pass: false, score: 0, matched: [] })).toBe(st);
    st = speakReduce(st, { kind: 'me' });
    expect(st.done).toBe('listened');
    expect(st.mistakes).toBe(0);
    expect(speakReduce(speakInit(), { kind: 'me' }).done).toBeNull();
    expect(speakReduce(speakInit(), { kind: 'skip' }).done).toBe('skipped');
  });

  it('never listens longer than LISTEN_MAX_MS, whatever the target', () => {
    expect(LISTEN_MAX_MS).toBe(10_000);
    for (const ms of [200, 1500, 4400, 5700, 20_000]) expect(recordLimitMs(ms)).toBeLessThanOrEqual(LISTEN_MAX_MS);
    expect(recordLimitMs(30_000, 28_000)).toBe(LISTEN_MAX_MS);
    expect(recordLimitMs(1000, 5000)).toBeLessThanOrEqual(5000);
  });

  it('splits French words like the server lists them', () => {
    expect(frWords("Qu'est-ce que tu fais, là ?")).toEqual(["Qu'est-ce", 'que', 'tu', 'fais,', 'là']);
  });
});

describe('maskFrench', () => {
  it('keeps the first letters, spaces, apostrophes and hyphens', () => {
    expect(maskFrench('par Toutatis', 'each')).toBe('p·· T·······');
    expect(maskFrench('par Toutatis', 'first')).toBe('p·· ········');
    expect(maskFrench("l'homme", 'each')).toBe("l'·····");
    expect(maskFrench('peut-être', 'each')).toBe('p···-ê···');
    expect(maskFrench('à la', 'each')).toBe('à l·');
    expect(maskFrench('Évidemment', 'first')).toBe('É·········');
    expect(maskFrench('Ah, ça !', 'first')).toBe('A·, ·· !');
    for (const s of ["aujourd'hui", 'c’est-à-dire', 'y a'])
      for (const m of ['each', 'first'] as const) expect(maskFrench(s, m).length).toBe(s.length);
  });
});

describe('say-line', () => {
  it('builds valid puzzles on every real scene: always a whole line, shorter ones first at low levels', () => {
    let built = 0;
    const words: Record<number, number[]> = { 1: [], 6: [] };
    for (const scene of scenes)
      for (const level of [1, 3, 6]) {
        const puzzle = sayLine.build(ctxFor(scene, level, 5)) as SayLinePuzzle | null;
        if (!puzzle) continue;
        built++;
        expect(sayLine.validate(puzzle, scene)).toEqual([]);
        const line = scene.lines.find((l) => l.id === puzzle.lineId)!;
        expect(puzzle.text).toBe(line.fr); // the whole line, never a part (the user's rule)
        expect([puzzle.startMs, puzzle.endMs]).toEqual([line.startMs, line.endMs]);
        expect('unitId' in puzzle).toBe(false);
        words[level]?.push(wordCount(puzzle.text));
        expect(playPuzzle(puzzle, sayLine, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, sayLine, { mode: 'clumsy', seed: 2 }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 3 * 0.9);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(mean(words[1]!)).toBeLessThan(mean(words[6]!));
    expect(preferredWordsForLevel(1)).toBeLessThan(preferredWordsForLevel(6));
  });

  it('validate catches a text that is not the line', () => {
    const scene = scenes[0]!;
    const puzzle = sayLine.build(ctxFor(scene, 5, 1))!;
    expect(sayLine.validate({ ...puzzle, text: 'autre chose' }, scene).join()).toMatch(/text/);
    expect(sayLine.validate({ ...puzzle, endMs: puzzle.startMs + 10 }, scene).join()).toMatch(/short/);
    expect(sayLine.validate({ ...puzzle, unitId: scene.lines[0]!.units[0]!.id } as SayLinePuzzle, scene).join()).toMatch(/part of the line/);
    expect(sayLine.validate({ ...puzzle, maxRecordMs: 15_000 }, scene).join()).toMatch(/recording limit/);
  });
});

describe('say-hidden', () => {
  it('builds valid puzzles from silver (level 2) on every real scene', () => {
    let built = 0;
    for (const scene of scenes)
      for (const level of [2, 4, 6]) {
        const puzzle = sayHidden.build(ctxFor(scene, level, 9)) as SayHiddenPuzzle | null;
        if (!puzzle) continue;
        built++;
        expect(sayHidden.validate(puzzle, scene)).toEqual([]);
        expect(puzzle.mask).toContain(MASK_CHAR);
        expect(playPuzzle(puzzle, sayHidden, { mode: 'perfect' }).problems).toEqual([]);
        expect(playPuzzle(puzzle, sayHidden, { mode: 'clumsy', seed: 4 }).problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 3 * 0.95);
    expect(sayHidden.meta.minLevel).toBe(2);
  });

  it('hides more at higher levels', () => {
    const scene = scenes.find((s) => s.lines.some((l) => l.units.some((u) => u.key && wordCount(u.fr) >= 2)))!;
    const unit = scene.lines.flatMap((l) => l.units).find((u) => u.key && wordCount(u.fr) >= 2 && u.fr !== u.en)!;
    const t1 = sayHidden.build(ctxFor(scene, 2, 1, { focusUnitIds: new Set([unit.id]) }))!;
    const t3 = sayHidden.build(ctxFor(scene, 4, 1, { focusUnitIds: new Set([unit.id]) }))!;
    const shown = (m: string) => [...m].filter((c) => /\p{L}/u.test(c)).length;
    expect(shown(t3.mask)).toBeLessThan(shown(t1.mask));
  });

  it('validate catches a mask that leaks or changes punctuation', () => {
    const scene = scenes[0]!;
    const puzzle = sayHidden.build(ctxFor(scene, 3, 1))!;
    expect(sayHidden.validate({ ...puzzle, mask: puzzle.fr }, scene).join()).toMatch(/nothing is hidden/);
    expect(sayHidden.validate({ ...puzzle, mask: MASK_CHAR.repeat(puzzle.fr.length) }, scene).join()).toMatch(/first letter/);
    expect(sayHidden.validate({ ...puzzle, mask: puzzle.mask + '·' }, scene).join()).toMatch(/length/);
  });
});

describe('targeted builds (the practice composer)', () => {
  it('say-line says the whole target line, at every level, on every line of every scene', () => {
    let n = 0;
    let lines = 0;
    for (const scene of scenes.slice(0, 60)) lines += scene.lines.length;
    for (const scene of scenes.slice(0, 60))
      for (const line of scene.lines) {
        for (const level of [1, 5]) {
          const puzzle = sayLine.build(ctxFor(scene, level, 1, { targetLineId: line.id }));
          if (!puzzle) continue;
          n++;
          expect(puzzle.lineId).toBe(line.id);
          expect(puzzle.text).toBe(line.fr);
          expect(sayLine.validate(puzzle, scene)).toEqual([]);
        }
      }
    expect(n).toBeGreaterThan(lines * 2 * 0.8); // most lines, at both levels, whatever the bundle holds
  });
});
