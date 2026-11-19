import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { playPuzzle } from '../practice/bot';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { nearlyEqual } from './listen-pick';
import { clash, foldFr, match, nameLike, normFr, pairsForLevel, type MatchPuzzle } from './match';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle ? readdirSync(`${dataDir}scenes`).map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene) : [FIXTURE_SCENE];

function ctxFor(scene: Scene, level: number, seed: number, extra: Partial<BuildCtx> = {}): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others: [], bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra };
}

describe('match', () => {
  it('normalises French for comparison', () => {
    expect(normFr('  Aujourd’hui, Obélix !')).toBe("aujourd'hui obélix");
    expect(foldFr('Évidemment')).toBe(foldFr('evidemment'));
    expect(nameLike({ fr: 'Obélix', en: 'Obelix' })).toBe(true);
    expect(nameLike({ fr: 'sanglier', en: 'boar' })).toBe(false);
    expect(clash({ fr: 'oui', en: 'yes' }, { fr: 'Oui !', en: 'yeah' })).toBe(true);
    // Every English card is a wrong choice for every other French one (docs/app-games.md, "Choices").
    expect(clash({ fr: 'le chef', en: 'the chief' }, { fr: 'un chef', en: 'a chief' })).toBe(true);
    expect(clash({ fr: 'Un monde', en: 'a world' }, { fr: 'Dans ce monde', en: 'in this world' })).toBe(true);
    expect(clash({ fr: 'Un monde', en: 'a world' }, { fr: 'merveilleux', en: 'wonderful' })).toBe(false);
  });

  it('builds valid boards on every real scene and level, sized by the level', () => {
    let built = 0;
    for (const scene of scenes)
      for (const level of [1, 3, 6]) {
        const puzzle = match.build(ctxFor(scene, level, 7)) as MatchPuzzle | null;
        if (!puzzle) continue;
        built++;
        expect(match.validate(puzzle, scene)).toEqual([]);
        expect(puzzle.pairs.length).toBeLessThanOrEqual(pairsForLevel(level));
        expect(puzzle.pairs.length).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < puzzle.pairs.length; i++)
          for (let j = i + 1; j < puzzle.pairs.length; j++) expect(nearlyEqual(puzzle.pairs[i]!.en, puzzle.pairs[j]!.en)).toBe(false);
        const perfect = playPuzzle(puzzle, match, { mode: 'perfect' });
        expect(perfect.problems).toEqual([]);
        const clumsy = playPuzzle(puzzle, match, { mode: 'clumsy', seed: 3 });
        expect(clumsy.problems).toEqual([]);
      }
    expect(built).toBeGreaterThan(scenes.length * 3 * 0.95);
  });

  bundleIt('prefers weak units and avoids used ones', () => {
    const scene = scenes.find((s) => s.lines.flatMap((l) => l.units.filter((u) => u.key)).length >= 12)!;
    const keys = scene.lines.flatMap((l) => l.units.filter((u) => u.key && !nameLike(u)));
    const weak = keys[keys.length - 1]!;
    const t1 = match.build(ctxFor(scene, 1, 1, { focusUnitIds: new Set([weak.id]) }))!;
    expect(t1.unitIds).toContain(weak.id);
    const used = new Set(t1.unitIds);
    const t2 = match.build(ctxFor(scene, 1, 1, { usedUnitIds: new Set(used) }))!;
    expect(t2.unitIds.filter((id) => used.has(id)).length).toBe(0);
  });

  it('counts wrong pairs per French tile and never finishes on one', () => {
    const puzzle = match.build(ctxFor(scenes[0]!, 1, 2))!;
    let st = match.init(puzzle);
    st = match.reduce(puzzle, st, { kind: 'pair', fr: 0, en: 1 });
    st = match.reduce(puzzle, st, { kind: 'pair', fr: 0, en: 2 });
    expect(st.wrong[0]).toBe(2);
    expect(match.mistakes(puzzle, st)).toBe(2);
    expect(match.isDone(puzzle, st)).toBe(false);
    expect(match.missedUnitIds(puzzle, st)).toEqual([puzzle.pairs[0]!.unitId]);
    st = match.reduce(puzzle, st, { kind: 'pair', fr: 0, en: 0 });
    expect(st.matched).toEqual([0]);
    // A matched tile cannot be paired again, and pairing with it counts nothing.
    const again = match.reduce(puzzle, st, { kind: 'pair', fr: 1, en: 0 });
    expect(again).toBe(st);
  });

  it('validate catches broken boards', () => {
    const scene = scenes[0]!;
    const puzzle = match.build(ctxFor(scene, 4, 4))!;
    const dupEn: MatchPuzzle = { ...puzzle, pairs: puzzle.pairs.map((p, i) => (i === 1 ? { ...p, en: puzzle.pairs[0]!.en } : p)) };
    expect(match.validate(dupEn, scene).join()).toMatch(/nearly equal|does not match/);
    const dupFr: MatchPuzzle = { ...puzzle, pairs: puzzle.pairs.map((p, i) => (i === 1 ? puzzle.pairs[0]! : p)) };
    expect(match.validate(dupFr, scene).join()).toMatch(/twice|same/);
    expect(match.validate({ ...puzzle, enOrder: puzzle.enOrder.slice(1) }, scene).join()).toMatch(/permutation/);
    expect(match.validate({ ...puzzle, helpLineIds: [] }, scene).join()).toMatch(/help strip/);
    expect(match.validate({ ...puzzle, pairs: puzzle.pairs.slice(0, 2), enOrder: [0, 1] }, scene).join()).toMatch(/pairs/);
  });
});
