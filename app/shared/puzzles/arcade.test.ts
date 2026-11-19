// Unit tests of the arcade puzzle types (rebuild, comic-order, catapult, vrai-faux, memory), with the
// helpers they share: the real bundle when it is exported, a BuildCtx, and a generic suite that
// every arcade puzzle type passes (build across levels on real scenes, validate, both bots, wrong moves).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ContentIndex, Scene } from '../content';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import type { BotHooks } from '../practice/bot';
import { playPuzzle } from '../practice/bot';
import { createRng } from '../practice/rng';
import type { BuildCtx, PuzzleType, PuzzleBase } from '../practice/types';
import { catapult, catapultShape, type CatapultPuzzle } from './catapult';
import { lineMeaning, type LineMeaningPuzzle } from './line-meaning';
import { nextLine, type NextLinePuzzle } from './next-line';
import { placeWords, PLACE_MAX, type PlaceWordsPuzzle } from './place-words';
import { closeInMeaning, frenchRelated, meaningUnits, normalizeFr, pickDistinctUnits, pickDistractors, relatedGlosses, unitGlossPools, unitRef } from './arcade';
import { comicOrder, type ComicOrderPuzzle } from './comic-order';
import { enContentWords, stemEn } from './distinct';
import { lockedSide, memory, partnerOf, type MemoryPuzzle } from './memory';
import { rebuild, rebuildRange, REBUILD_REVEAL_AFTER, type RebuildPuzzle } from './rebuild';
import { vraiFaux, type VraiFauxPuzzle } from './vrai-faux';

const dataDir = fileURLToPath(new URL('../../public/data/', import.meta.url));
const haveBundle = existsSync(`${dataDir}index.json`);
/** Tests that need the real scenes of the exported bundle (`frenchirix export-app`); skipped without it. */
const bundleIt = haveBundle ? it : it.skip;
const bank: ContentIndex['bank'] = haveBundle ? (JSON.parse(readFileSync(`${dataDir}index.json`, 'utf8')) as ContentIndex).bank : FIXTURE_INDEX.bank;
const scenes: Scene[] = haveBundle
  ? readdirSync(`${dataDir}scenes`)
      .sort()
      .map((f) => JSON.parse(readFileSync(`${dataDir}scenes/${f}`, 'utf8')) as Scene)
  : [FIXTURE_SCENE];

function ctxFor(scene: Scene, seed: number, level = 1, others: Scene[] = []): BuildCtx {
  return { scene, level, rng: createRng(seed), focusUnitIds: new Set(), others, bank, usedLineIds: new Set(), usedUnitIds: new Set() };
}

function othersFor(scene: Scene): Scene[] {
  return scenes.filter((s) => s.id !== scene.id).slice(0, 2);
}

type Logic<T extends PuzzleBase, S, A> = PuzzleType<T, S, A> & BotHooks<T, S, A>;

/** The shared checks: builds on real scenes at every level, validates, perfect and clumsy bots finish. */
function arcadeSuite<T extends PuzzleBase, S, A>(logic: Logic<T, S, A>, opts: { nullOk?: (scene: Scene) => boolean; wholeScene?: boolean; needsBundle?: boolean } = {}) {
  // needsBundle: the puzzle type builds nothing on the two-line fixture scene.
  const realIt = opts.needsBundle ? bundleIt : it;
  realIt('builds valid puzzles across levels that both bots finish', () => {
    let tries = 0;
    let built = 0;
    const nulls: string[] = [];
    for (const scene of scenes) {
      for (const level of [1, 3, 6]) {
        tries++;
        const puzzle = logic.build(ctxFor(scene, level, level, othersFor(scene)));
        if (!puzzle) {
          nulls.push(`${scene.id}@${level}`);
          // A null must have a stated reason, whatever scenes the bundle holds.
          if (opts.nullOk) expect(opts.nullOk(scene), `${logic.type} returned null for ${scene.id} at level ${level} without a reason`).toBe(true);
          continue;
        }
        built++;
        expect(puzzle.type).toBe(logic.type);
        expect(logic.validate(puzzle, scene), `${scene.id} level ${level}`).toEqual([]);
        const perfect = playPuzzle(puzzle, logic, { mode: 'perfect' });
        expect(perfect.problems, `${scene.id} level ${level} perfect`).toEqual([]);
        expect(perfect.run.mistakes).toBe(0);
        const clumsy = playPuzzle(puzzle, logic, { mode: 'clumsy', seed: level + 6 });
        expect(clumsy.problems, `${scene.id} level ${level} clumsy`).toEqual([]);
      }
    }
    // The share is printed, not asserted: it depends on which scenes the bundle holds.
    console.log(`${logic.type}: built ${built}/${tries} over ${scenes.length} scenes${nulls.length ? `; null for ${nulls.slice(0, 8).join(' ')}` : ''}`);
    expect(built, `${logic.type} built nothing`).toBeGreaterThan(0);
  });

  realIt('is deterministic for a seed and marks what it uses', () => {
    const scene = scenes.find((s) => logic.build(ctxFor(s, 3)) !== null)!;
    expect(logic.build(ctxFor(scene, 42))).toEqual(logic.build(ctxFor(scene, 42)));
    const c = ctxFor(scene, 5);
    const puzzle = logic.build(c)!;
    if (opts.wholeScene) for (const id of puzzle.unitIds) expect(c.usedUnitIds.has(id)).toBe(true);
    else for (const id of puzzle.helpLineIds) expect(c.usedLineIds.has(id)).toBe(true);
  });

  it('prefers lines not used yet', () => {
    if (opts.wholeScene) return; // a whole-scene puzzle shows every line
    // Over the scenes where a second, different puzzle exists, the second build must avoid the used lines.
    let tried = 0;
    let fresh = 0;
    for (const scene of scenes.filter((x) => x.lines.length >= 8)) {
      const first = logic.build(ctxFor(scene, 1));
      if (!first) continue;
      const c = ctxFor(scene, 1);
      for (const id of first.helpLineIds) c.usedLineIds.add(id);
      const second = logic.build(c);
      if (!second) continue;
      tried++;
      if (second.helpLineIds.some((id) => !first.helpLineIds.includes(id))) fresh++;
    }
    if (tried) expect(fresh / tried).toBeGreaterThan(0.8);
  });

  it('never lets wrong moves finish a puzzle, and counts each', () => {
    for (const scene of scenes.slice(0, 40)) {
      const puzzle = logic.build(ctxFor(scene, 11, 4, othersFor(scene)));
      if (!puzzle) continue;
      const rng = createRng(3);
      let st = logic.init(puzzle);
      for (let k = 0; k < 6 && !logic.isDone(puzzle, st); k++) {
        const w = logic.wrongAction!(puzzle, st, rng);
        if (w === null) {
          st = logic.reduce(puzzle, st, logic.solve(puzzle, st));
          continue;
        }
        const before = logic.mistakes(puzzle, st);
        st = logic.reduce(puzzle, st, w);
        expect(logic.isDone(puzzle, st)).toBe(false);
        expect(logic.mistakes(puzzle, st)).toBe(before + 1);
      }
    }
  });
}

describe('rebuild', () => {
  arcadeSuite(rebuild); // null: no line with 3-8 pieces of distinct text (printed)

  it('uses units early and more, smaller tiles later', () => {
    let wordsLate = 0;
    let n = 0;
    for (const scene of scenes.slice(0, 60)) {
      const early = rebuild.build(ctxFor(scene, 1, 1));
      if (early) {
        const [lo, hi] = rebuildRange(0);
        expect(early.tiles.length).toBeGreaterThanOrEqual(lo);
        expect(early.tiles.length).toBeLessThanOrEqual(hi);
      }
      const late = rebuild.build(ctxFor(scene, 1, 6));
      if (late) {
        n++;
        if (late.words) wordsLate++;
      }
    }
    // Later levels prefer word tiles: true whenever a line fits both (computed, not a share).
    if (n) expect(wordsLate).toBeGreaterThan(0);
  });

  it('counts wrong taps per slot, ignores placed tiles, reveals after two', () => {
    const puzzle = rebuild.build(ctxFor(FIXTURE_SCENE, 2, 2)) as RebuildPuzzle;
    expect(puzzle).toBeTruthy();
    let st = rebuild.init(puzzle);
    const wrong = puzzle.answer[2]!;
    st = rebuild.reduce(puzzle, st, { kind: 'tap', tile: wrong });
    st = rebuild.reduce(puzzle, st, { kind: 'tap', tile: wrong });
    expect(st.wrongAt[0]).toBe(REBUILD_REVEAL_AFTER);
    expect(rebuild.mistakes(puzzle, st)).toBe(2);
    st = rebuild.reduce(puzzle, st, { kind: 'tap', tile: puzzle.answer[0]! });
    const again = rebuild.reduce(puzzle, st, { kind: 'tap', tile: puzzle.answer[0]! });
    expect(again).toBe(st);
    expect(rebuild.missedUnitIds(puzzle, st).length).toBeGreaterThan(0);
  });

  it('flags broken puzzles', () => {
    const puzzle = rebuild.build(ctxFor(FIXTURE_SCENE, 2, 2)) as RebuildPuzzle;
    expect(rebuild.validate({ ...puzzle, tiles: puzzle.answer.map((id) => puzzle.tiles.find((t) => t.id === id)!) }, FIXTURE_SCENE)).toContain('rebuild: the tiles are already in order');
    const dup = { ...puzzle, tiles: puzzle.tiles.map((t, i) => (i === 1 ? { ...t, fr: puzzle.tiles[0]!.fr } : t)) };
    expect(rebuild.validate(dup, FIXTURE_SCENE).some((p) => p.includes('same text'))).toBe(true);
    expect(rebuild.validate({ ...puzzle, helpLineIds: [] }, FIXTURE_SCENE).some((p) => p.includes('help strip'))).toBe(true);
  });
});

describe('comic-order', () => {
  arcadeSuite(comicOrder, { needsBundle: true }); // null: no run of 3 told-apart lines within 24 s (printed)

  bundleIt('takes three panels early, four from titanium (level 4) when the scene allows', () => {
    // Panels need distinct frames, so not every long scene allows four.
    const scene = scenes.find((s) => s.lines.length >= 6 && comicOrder.build(ctxFor(s, 1, 5))?.answer.length === 4)!;
    expect(comicOrder.build(ctxFor(scene, 1, 1))!.answer).toHaveLength(3);
    expect(comicOrder.build(ctxFor(scene, 1, 5))!.answer).toHaveLength(4);
  });

  bundleIt('flags a puzzle out of spoken order or with shuffled cards in order', () => {
    const scene = scenes.find((s) => s.lines.length >= 6)!;
    const puzzle = comicOrder.build(ctxFor(scene, 1, 1)) as ComicOrderPuzzle;
    const rev = [...puzzle.answer].reverse();
    expect(comicOrder.validate({ ...puzzle, answer: rev, cards: puzzle.answer }, scene).length).toBeGreaterThan(0);
    expect(comicOrder.validate({ ...puzzle, cards: puzzle.answer }, scene)).toContain('comic-order: the cards are already in order');
  });

  bundleIt('reveals after two wrong panels on a slot', () => {
    const scene = scenes.find((s) => s.lines.length >= 6)!;
    const puzzle = comicOrder.build(ctxFor(scene, 1, 1)) as ComicOrderPuzzle;
    let st = comicOrder.init(puzzle);
    st = comicOrder.reduce(puzzle, st, { kind: 'place', lineId: puzzle.answer[1]! });
    st = comicOrder.reduce(puzzle, st, { kind: 'place', lineId: puzzle.answer[2]! });
    expect(st.wrongAt[0]).toBe(2);
    expect(comicOrder.isDone(puzzle, st)).toBe(false);
    expect(comicOrder.missedUnitIds(puzzle, st).every((u) => u.startsWith(puzzle.answer[0]!))).toBe(true);
  });
});

describe('wrong choices (pickDistractors)', () => {
  it('skips glosses close in meaning, from related French, or close to a related unit', () => {
    const answer = { fr: 'Un monde', en: 'a world' };
    const pools = [[
      { fr: 'Dans ce monde', en: 'in this world' }, // shares "world"
      { fr: 'les mondes', en: 'the planets' }, // related French
      { fr: 'la terre', en: 'the earth and the sky' }, // close to a related unit's English ("earth")
      { fr: 'un chien', en: 'a dog' },
      { fr: 'des sangliers', en: 'wild boars' },
    ]];
    expect(pickDistractors(answer, pools, 4, ['the whole earth'])).toEqual(['a dog', 'wild boars']);
  });

  it('never picks two wrong choices close to each other ("Roman": not both "a world" and "in this world")', () => {
    const answer = { fr: 'romain', en: 'Roman' };
    const pools = [[
      { fr: 'Un monde', en: 'a world' },
      { fr: 'Dans ce monde', en: 'in this world' }, // close to "a world"
      { fr: 'le village', en: 'the village' },
    ]];
    expect(pickDistractors(answer, pools, 2)).toEqual(['a world', 'the village']);
  });

  it('draws from the scene, then other scenes, then the bank, with their French', () => {
    const ctx = ctxFor(FIXTURE_SCENE, 1);
    const pools = unitGlossPools(ctx, ctx.rng);
    expect(pools).toHaveLength(3);
    for (const g of pools.flat()) expect(typeof g.fr === 'string' && typeof g.en === 'string').toBe(true);
  });
});

describe('catapult', () => {
  arcadeSuite(catapult, { nullOk: (sc) => pickDistinctUnits(meaningUnits(sc), 2).length < 2 });

  it('grows with the level', () => {
    const early = catapult.build(ctxFor(FIXTURE_SCENE, 1, 1))!;
    const late = catapult.build(ctxFor(FIXTURE_SCENE, 1, 6))!;
    expect(early.rounds[0]!.choices).toHaveLength(catapultShape(1).choices);
    expect(late.rounds.length).toBeGreaterThanOrEqual(early.rounds.length);
    expect(late.rounds[0]!.choices).toHaveLength(catapultShape(6).choices);
  });

  it('counts a wrong shot once, keeps the round, moves on with the right one', () => {
    const puzzle = catapult.build(ctxFor(FIXTURE_SCENE, 4, 3)) as CatapultPuzzle;
    const r0 = puzzle.rounds[0]!;
    const wrong = r0.choices.findIndex((c) => !c.correct);
    let st = catapult.init(puzzle);
    st = catapult.reduce(puzzle, st, { kind: 'fire', index: wrong });
    st = catapult.reduce(puzzle, st, { kind: 'fire', index: wrong });
    expect(catapult.mistakes(puzzle, st)).toBe(1);
    expect(st.round).toBe(0);
    st = catapult.reduce(puzzle, st, catapult.solve(puzzle, st));
    expect(st.round).toBe(1);
    expect(catapult.missedUnitIds(puzzle, st)).toEqual([r0.unitId]);
  });

  it('never offers a sign close in meaning to the right one ("Un monde": not "in this world")', () => {
    const rien = sceneById('s01e04-0014-0015');
    for (const scene of rien ? [rien, ...scenes] : scenes)
      for (const level of [1, 3, 6])
        for (const target of [undefined, ...scene.lines.map((l) => l.id)]) {
          const puzzle = catapult.build({ ...ctxFor(scene, level * 13, level), targetLineId: target }) as CatapultPuzzle | null;
          if (!puzzle) continue;
          for (const r of puzzle.rounds) {
            const unit = unitRef(scene, r.unitId)!.unit;
            const related = relatedGlosses(scene, unit);
            for (const [i, a] of r.choices.entries())
              for (const b of r.choices.slice(i + 1)) expect(closeInMeaning(a.en, b.en), `${scene.id} ${unit.fr}: "${a.en}" / "${b.en}"`).toBe(false);
            for (const c of r.choices.filter((x) => !x.correct)) {
              expect(closeInMeaning(c.en, unit.en), `${scene.id} ${unit.fr}: "${c.en}" / "${unit.en}"`).toBe(false);
              expect(related.some((g) => closeInMeaning(g, c.en)), `${scene.id} ${unit.fr}: "${c.en}" is close to a related unit's English`).toBe(false);
            }
          }
        }
  });

  it('flags a wrong sign that shares a content word with the right one', () => {
    const puzzle = catapult.build(ctxFor(FIXTURE_SCENE, 4, 3)) as CatapultPuzzle;
    const wordOf = (en: string) => en.split(/\s+/).find((w) => enContentWords(en).has(stemEn(w.toLowerCase().replace(/[^a-z']/g, ''))));
    const k = puzzle.rounds.findIndex((r) => wordOf(r.choices.find((c) => c.correct)!.en));
    expect(k, 'a round whose answer has a content word').toBeGreaterThanOrEqual(0);
    const r0 = puzzle.rounds[k]!;
    const word = wordOf(r0.choices.find((c) => c.correct)!.en)!;
    const rounds = puzzle.rounds.map((r, i) => (i === k ? { ...r, choices: r.choices.map((c) => (c.correct ? c : { en: `the big ${word} of the village`, correct: false })) } : r));
    const close = { ...puzzle, rounds };
    expect(catapult.validate(close, FIXTURE_SCENE).some((p) => p.includes('close in meaning'))).toBe(true);
  });

  it('flags near-duplicate choices and two right ones', () => {
    const puzzle = catapult.build(ctxFor(FIXTURE_SCENE, 4, 3)) as CatapultPuzzle;
    const r0 = puzzle.rounds[0]!;
    const right = r0.choices.find((c) => c.correct)!;
    const dup = { ...puzzle, rounds: [{ ...r0, choices: r0.choices.map((c) => (c.correct ? c : { en: right.en.toUpperCase() + '!', correct: false })) }, ...puzzle.rounds.slice(1)] };
    expect(catapult.validate(dup, FIXTURE_SCENE).some((p) => p.includes('nearly equal'))).toBe(true);
    const two = { ...puzzle, rounds: [{ ...r0, choices: r0.choices.map((c) => ({ ...c, correct: true })) }, ...puzzle.rounds.slice(1)] };
    expect(catapult.validate(two, FIXTURE_SCENE).length).toBeGreaterThan(0);
  });
});

describe('vrai-faux', () => {
  arcadeSuite(vraiFaux, { nullOk: (sc) => pickDistinctUnits(meaningUnits(sc), 4).length < 4 });

  it('mixes true and false cards', () => {
    for (const scene of scenes.slice(0, 50)) {
      const puzzle = vraiFaux.build(ctxFor(scene, 2, 4));
      if (!puzzle) continue;
      const t = puzzle.cards.filter((c) => c.truth).length;
      expect(t).toBeGreaterThanOrEqual(2);
      expect(puzzle.cards.length - t).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds a combo on right first answers and breaks it on a wrong one', () => {
    const puzzle = vraiFaux.build(ctxFor(FIXTURE_SCENE, 3, 1)) as VraiFauxPuzzle;
    let st = vraiFaux.init(puzzle);
    st = vraiFaux.reduce(puzzle, st, vraiFaux.solve(puzzle, st));
    st = vraiFaux.reduce(puzzle, st, vraiFaux.solve(puzzle, st));
    expect(st.streak).toBe(2);
    st = vraiFaux.reduce(puzzle, st, vraiFaux.wrongAction!(puzzle, st, null as never)!);
    expect(st.streak).toBe(0);
    expect(st.card).toBe(2);
    st = vraiFaux.reduce(puzzle, st, vraiFaux.solve(puzzle, st));
    expect(st.streak).toBe(0);
    expect(st.best).toBe(2);
    expect(vraiFaux.missedUnitIds(puzzle, st)).toEqual([puzzle.cards[2]!.unitId]);
  });

  it('never shows a false meaning close to the right one', () => {
    for (const scene of scenes)
      for (const level of [1, 6]) {
        const puzzle = vraiFaux.build(ctxFor(scene, level * 5, level)) as VraiFauxPuzzle | null;
        if (!puzzle) continue;
        for (const c of puzzle.cards.filter((x) => !x.truth)) expect(closeInMeaning(c.shownEn, c.rightEn), `${scene.id}: "${c.shownEn}" / "${c.rightEn}"`).toBe(false);
      }
  });

  it('flags a false card that shows the right meaning', () => {
    const puzzle = vraiFaux.build(ctxFor(FIXTURE_SCENE, 3, 1)) as VraiFauxPuzzle;
    const i = puzzle.cards.findIndex((c) => !c.truth);
    const bad = { ...puzzle, cards: puzzle.cards.map((c, k) => (k === i ? { ...c, shownEn: c.rightEn + '.' } : c)) };
    expect(vraiFaux.validate(bad, FIXTURE_SCENE).some((p) => p.includes('close in meaning'))).toBe(true);
  });
});

describe('memory', () => {
  arcadeSuite(memory, { nullOk: (sc) => pickDistinctUnits(meaningUnits(sc).filter((r) => r.unit.fr.length <= 30 && r.unit.en.length <= 32), 3, { apart: true }).length < 3 });

  it('does not count a first-time mismatch, counts one the kid could have known', () => {
    const puzzle = memory.build(ctxFor(FIXTURE_SCENE, 1, 1)) as MemoryPuzzle;
    const a = 0;
    const pa = partnerOf(puzzle, a);
    // A shield of the other language than a (the same side as pa), from another pair.
    const other = puzzle.cards.findIndex((c, i) => i !== a && i !== pa && c.side !== puzzle.cards[a]!.side);
    // A shield of a's language, from another pair: it is the wrong move once pa is up.
    const otherA = puzzle.cards.findIndex((c, i) => i !== a && c.side === puzzle.cards[a]!.side);
    let st = memory.init(puzzle);
    st = memory.reduce(puzzle, st, { kind: 'flip', card: a });
    st = memory.reduce(puzzle, st, { kind: 'flip', card: other });
    expect(memory.mistakes(puzzle, st)).toBe(0);
    expect(st.open).toEqual([a, other]);
    // Now see the partner, then turn a shield of a's language that is not a: a miss on purpose.
    st = memory.reduce(puzzle, st, { kind: 'flip', card: pa });
    expect(st.open).toEqual([pa]);
    st = memory.reduce(puzzle, st, { kind: 'flip', card: otherA });
    // pa's partner (a) was seen: a mistake.
    expect(memory.mistakes(puzzle, st)).toBe(1);
    st = memory.reduce(puzzle, st, { kind: 'flip', card: a });
    st = memory.reduce(puzzle, st, { kind: 'flip', card: pa });
    expect(st.matched).toEqual([puzzle.cards[a]!.pair]);
    // A matched shield cannot be turned again.
    expect(memory.reduce(puzzle, st, { kind: 'flip', card: a })).toBe(st);
  });

  it('flags a pair without both sides', () => {
    const puzzle = memory.build(ctxFor(FIXTURE_SCENE, 1, 1)) as MemoryPuzzle;
    const bad = { ...puzzle, cards: puzzle.cards.map((c) => ({ ...c, side: 'fr' as const })) };
    expect(memory.validate(bad, FIXTURE_SCENE).length).toBeGreaterThan(0);
  });

  it('locks the shields of the face-up one\'s language until one of the other language is turned', () => {
    const puzzle = memory.build(ctxFor(FIXTURE_SCENE, 1, 1)) as MemoryPuzzle;
    const a = 0;
    const same = puzzle.cards.findIndex((c, i) => i !== a && c.side === puzzle.cards[a]!.side);
    let st = memory.reduce(puzzle, memory.init(puzzle), { kind: 'flip', card: a });
    expect(lockedSide(puzzle, st)).toBe(puzzle.cards[a]!.side);
    expect(memory.reduce(puzzle, st, { kind: 'flip', card: same })).toBe(st);
    // The bots never try a locked shield: every wrong move and every perfect move is of the other language.
    for (let seed = 0; seed < 20; seed++) {
      const w = memory.wrongAction!(puzzle, st, createRng(seed));
      if (w) expect(puzzle.cards[w.card]!.side).not.toBe(puzzle.cards[a]!.side);
    }
    expect(puzzle.cards[memory.solve(puzzle, st).card]!.side).not.toBe(puzzle.cards[a]!.side);
    // A mismatched pair is face up: nothing is locked, the next tap may be any shield.
    st = memory.reduce(puzzle, st, { kind: 'flip', card: puzzle.cards.findIndex((c, i) => c.pair !== puzzle.cards[a]!.pair && c.side !== puzzle.cards[a]!.side && i !== a) });
    expect(st.open).toHaveLength(2);
    expect(lockedSide(puzzle, st)).toBe(null);
  });

  it('never deals two pairs close in meaning or with related French', () => {
    for (const scene of scenes)
      for (const level of [1, 6]) {
        const puzzle = memory.build(ctxFor(scene, level, level)) as MemoryPuzzle | null;
        if (!puzzle) continue;
        for (const [i, p] of puzzle.pairs.entries())
          for (const q of puzzle.pairs.slice(i + 1)) {
            expect(closeInMeaning(p.en, q.en), `${scene.id}: "${p.en}" / "${q.en}"`).toBe(false);
            expect(frenchRelated(p.fr, q.fr), `${scene.id}: "${p.fr}" / "${q.fr}"`).toBe(false);
          }
      }
  });
});

const PANONO = 's01e03-0023-0026';
const sceneById = (id: string) => scenes.find((x) => x.id === id);
/** A dialogue of at least four lines among the scenes the bundle holds. */
const DIALOGUE = (scenes.find((x) => x.kind === 'dialogue' && x.lines.length >= 4 && nextLine.build(ctxFor(x, 1)) && lineMeaning.build(ctxFor(x, 1, 4))) ?? scenes[0]!).id;

describe('place-words', () => {
  arcadeSuite(placeWords, { nullOk: (sc) => new Set(sc.lines.flatMap((l) => l.units.filter((u) => u.key).map((u) => normalizeFr(u.fr)))).size < 2, wholeScene: true });

  it('lifts up to five pieces, spread over the lines, never two alike', () => {
    for (const sc of scenes.slice(0, 80)) {
      const puzzle = placeWords.build(ctxFor(sc, 3)) as PlaceWordsPuzzle | null;
      if (!puzzle) continue;
      expect(puzzle.gaps.length).toBeLessThanOrEqual(PLACE_MAX);
      const texts = puzzle.gaps.map((id) => normalizeFr(sc.lines.flatMap((l) => l.units).find((u) => u.id === id)!.fr));
      expect(new Set(texts).size).toBe(texts.length);
      const lines = new Set(puzzle.gaps.map((id) => id.slice(0, id.lastIndexOf(':'))));
      // One per line first (a line whose only piece reads like a chosen one may be skipped).
      expect(lines.size).toBeGreaterThanOrEqual(Math.min(puzzle.gaps.length, sc.lines.filter((l) => l.units.some((u) => u.key)).length) - 1);
    }
  });

  it('works on the Panono song, with a gap on every line that has one to give', () => {
    const sc = sceneById(PANONO);
    if (!sc) return;
    const puzzle = placeWords.build(ctxFor(sc, 1)) as PlaceWordsPuzzle;
    expect(placeWords.validate(puzzle, sc)).toEqual([]);
    expect(new Set(puzzle.gaps.map((id) => id.slice(0, id.lastIndexOf(':')))).size).toBeGreaterThanOrEqual(3);
  });

  it('bounces a piece from a wrong gap, ignores filled gaps, reveals after two', () => {
    const puzzle = placeWords.build(ctxFor(FIXTURE_SCENE, 2)) as PlaceWordsPuzzle;
    const [a, b] = puzzle.gaps as [string, string];
    let st = placeWords.init(puzzle);
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: b });
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: b });
    expect(st.wrong[puzzle.tray.indexOf(a)]).toBe(2);
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: b, gap: b });
    expect(placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: b })).toBe(st);
    expect(placeWords.missedUnitIds(puzzle, st)).toEqual([a]);
  });
});

describe('next-line', () => {
  arcadeSuite(nextLine, { needsBundle: true }); // null: fewer than 3 lines, or no following pair said once each and told apart (printed)

  bundleIt('asks for the line that really follows, on the Panono song and on a dialogue', () => {
    for (const id of [PANONO, DIALOGUE]) {
      const sc = sceneById(id);
      if (!sc) continue;
      for (const level of [1, 4]) {
        const puzzle = nextLine.build(ctxFor(sc, 1, level)) as NextLinePuzzle;
        expect(puzzle, id).toBeTruthy();
        expect(nextLine.validate(puzzle, sc)).toEqual([]);
        for (const r of puzzle.rounds) {
          const i = sc.lines.findIndex((l) => l.id === r.promptId);
          expect(sc.lines[i + 1]!.id).toBe(r.answerId);
        }
      }
    }
  });

  it('returns null on a scene of two lines, and honours a target line', () => {
    const two = scenes.find((x) => x.lines.length < 3) ?? { ...scenes[0]!, lines: scenes[0]!.lines.slice(0, 2) };
    expect(nextLine.build(ctxFor(two, 1))).toBeNull();
    expect(lineMeaning.build(ctxFor(two, 1))).toBeNull();
    const sc = sceneById(DIALOGUE);
    if (!sc) return;
    for (const l of sc.lines) {
      const c = ctxFor(sc, 1, 3);
      c.targetLineId = l.id;
      const puzzle = nextLine.build(c);
      if (puzzle) expect(puzzle.rounds.some((r) => r.promptId === l.id || r.answerId === l.id)).toBe(true);
    }
  });
});

describe('line-meaning', () => {
  arcadeSuite(lineMeaning, { needsBundle: true }); // null: no run of 3 consecutive lines told apart (printed)

  bundleIt('lines up three or four lines of the Panono song and of a dialogue', () => {
    for (const id of [PANONO, DIALOGUE]) {
      const sc = sceneById(id);
      if (!sc) continue;
      const puzzle = lineMeaning.build(ctxFor(sc, 1, 4)) as LineMeaningPuzzle;
      expect(puzzle, id).toBeTruthy();
      expect(lineMeaning.validate(puzzle, sc)).toEqual([]);
      expect(puzzle.lineIds.length).toBeGreaterThanOrEqual(3);
    }
  });

  bundleIt('flags two lines that mean the same', () => {
    const sc = sceneById(DIALOGUE) ?? scenes.find((x) => x.lines.length >= 4)!;
    const puzzle = lineMeaning.build(ctxFor(sc, 1, 4)) as LineMeaningPuzzle;
    const copy = { ...sc, lines: sc.lines.map((l) => (l.id === puzzle.lineIds[1] ? { ...l, en: sc.lines.find((x) => x.id === puzzle.lineIds[0])!.en } : l)) };
    expect(lineMeaning.validate(puzzle, copy).some((p) => p.includes('mean nearly the same'))).toBe(true);
  });
});

describe('targeting (practice composer)', () => {
  const puzzleTypes = [rebuild, catapult, vraiFaux, memory, comicOrder, nextLine, lineMeaning] as const;
  it('every targeted build uses the target line, and single-line puzzle types only that line', () => {
    for (const sc of scenes.slice(0, 60)) {
      for (const l of sc.lines) {
        for (const g of puzzleTypes) {
          const c = ctxFor(sc, 2, 3, othersFor(sc));
          c.targetLineId = l.id;
          const puzzle = (g as any).build(c);
          if (!puzzle) continue;
          expect(puzzle.helpLineIds, `${g.type} ${l.id}`).toContain(l.id);
          if (g.meta.scope !== 'multi-line') expect(puzzle.helpLineIds, `${g.type} ${l.id}`).toEqual([l.id]);
          expect((g as any).validate(puzzle, sc), `${g.type} ${l.id}`).toEqual([]);
        }
      }
    }
  });
});
