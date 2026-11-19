// Unit tests of place-words in both orders: a piece then its gap, or a gap then its piece. The
// building, the bots and the generic checks are in arcade.test.ts.
import { describe, expect, it } from 'vitest';
import { FIXTURE_INDEX } from '../fixtures';
import { FIXTURE_SCENE } from '../fixtures/scene';
import { createRng } from '../practice/rng';
import type { BuildCtx } from '../practice/types';
import { placeReveal, placeWords, PLACE_REVEAL_AFTER, type PlaceWordsPuzzle } from './place-words';

function puzzleOf(): PlaceWordsPuzzle {
  const ctx: BuildCtx = { scene: FIXTURE_SCENE, level: 1, rng: createRng(2), focusUnitIds: new Set(), others: [], bank: FIXTURE_INDEX.bank, usedLineIds: new Set(), usedUnitIds: new Set() };
  const p = placeWords.build(ctx) as PlaceWordsPuzzle | null;
  if (!p) throw new Error('place-words does not build on the fixture scene');
  return p;
}

describe('place-words, both orders', () => {
  it('counts a wrong move once, on the piece and on the gap', () => {
    const puzzle = puzzleOf();
    const [a, b] = puzzle.gaps as [string, string];
    const st = placeWords.reduce(puzzle, placeWords.init(puzzle), { kind: 'place', piece: a, gap: b });
    expect(placeWords.mistakes(puzzle, st)).toBe(1);
    expect(st.wrong[puzzle.tray.indexOf(a)]).toBe(1);
    expect(st.wrongGap[puzzle.gaps.indexOf(b)]).toBe(1);
    expect(st.placed).toEqual([]);
  });

  it('shows the answer of the selected item after two wrong moves on it', () => {
    const puzzle = puzzleOf();
    expect(puzzle.gaps.length).toBeGreaterThanOrEqual(3); // two wrong pieces for one gap need three pieces
    const [a, b, c] = puzzle.gaps as [string, string, string];
    let st = placeWords.init(puzzle);
    // A gap first: two wrong pieces for gap a, then its piece glows; no piece is selected.
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: b, gap: a });
    expect(placeReveal(puzzle, st, { gap: a })).toBeNull();
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: c, gap: a });
    expect(PLACE_REVEAL_AFTER).toBe(2);
    expect(placeReveal(puzzle, st, { gap: a })).toBe(a);
    // Neither b nor c has two wrong gaps: selecting them shows nothing.
    expect(placeReveal(puzzle, st, { piece: b })).toBeNull();
    expect(placeReveal(puzzle, st, { piece: c })).toBeNull();
    // A piece first: piece b in a wrong gap once more, then its gap glows.
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: b, gap: c });
    expect(placeReveal(puzzle, st, { piece: b })).toBe(b);
    // Placed: nothing glows for it any more.
    st = placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: a });
    expect(placeReveal(puzzle, st, { gap: a })).toBeNull();
    expect(placeWords.mistakes(puzzle, st)).toBe(3);
  });

  it('never mutates the state it gets', () => {
    const puzzle = puzzleOf();
    const [a, b] = puzzle.gaps as [string, string];
    const st = placeWords.init(puzzle);
    const before = JSON.stringify(st);
    placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: b });
    placeWords.reduce(puzzle, st, { kind: 'place', piece: a, gap: a });
    expect(JSON.stringify(st)).toBe(before);
  });
});
