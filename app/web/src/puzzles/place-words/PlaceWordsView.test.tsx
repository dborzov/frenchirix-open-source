// The place-words view: placing in either order, and a tap on a line's panel looping that line.
import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_INDEX } from '../../../../shared/fixtures';
import { FIXTURE_SCENE } from '../../../../shared/fixtures/scene';
import { createRng } from '../../../../shared/practice/rng';
import { placeWords, type PlaceWordsAction, type PlaceWordsPuzzle, type PlaceWordsState } from '../../../../shared/puzzles/place-words';
import { audio } from '../../audio';
import type { PracticeCtx } from '../registry';
import { PlaceWordsView } from './PlaceWordsView';

const scene = FIXTURE_SCENE;
const puzzle = placeWords.build({ scene, level: 1, rng: createRng(2), focusUnitIds: new Set(), others: [], bank: FIXTURE_INDEX.bank, usedLineIds: new Set(), usedUnitIds: new Set() }) as PlaceWordsPuzzle;
const ctx: PracticeCtx = { practiceId: 'p', puzzleIndex: 0, puzzleCount: 1, layout: 'phone', speak: false, openHelp: () => {}, hint: () => {}, next: () => {} };
const lineOf = (unitId: string) => unitId.slice(0, unitId.lastIndexOf(':'));

function mount() {
  const seen: { state: PlaceWordsState } = { state: placeWords.init(puzzle) };
  function Host() {
    const [state, setState] = useState(seen.state);
    seen.state = state;
    const dispatch = (a: PlaceWordsAction) => setState((s) => placeWords.reduce(puzzle, s, a));
    return <PlaceWordsView puzzle={puzzle} state={state} dispatch={dispatch} scene={scene} practiceCtx={ctx} />;
  }
  const ui = render(<Host />);
  const q = (sel: string) => ui.container.querySelector(sel) as HTMLElement;
  const tap = (sel: string) => act(() => void fireEvent.click(q(sel)));
  return { ui, q, tap, seen };
}

describe('place-words view', () => {
  it('places a gap first, then its piece; a wrong piece keeps the gap selected', () => {
    const { q, tap, seen } = mount();
    const [a, b] = puzzle.gaps as [string, string];
    tap(`[data-gap="${a}"]`);
    expect(q('[data-place-words]').dataset.step).toBe('gap');
    expect(q(`[data-gap="${a}"]`).getAttribute('aria-pressed')).toBe('true');
    // Its line loops, marked on the panel and on the playback bar.
    expect(audio.getState().tag).toBe(`line:${lineOf(a)}`);
    expect(audio.getState().loop).toBe(true);
    expect(q(`[data-line="${lineOf(a)}"]`).hasAttribute('data-looping')).toBe(true);
    expect(q(`[data-bar-line="${lineOf(a)}"]`).hasAttribute('data-bar-loop')).toBe(true);
    tap(`[data-piece="${b}"]`);
    expect(placeWords.mistakes(puzzle, seen.state)).toBe(1);
    expect(q('[data-place-words]').dataset.step).toBe('gap');
    tap(`[data-piece="${a}"]`);
    expect(seen.state.placed).toEqual([a]);
    expect(q('[data-place-words]').dataset.step).toBe('idle');
  });

  it('still places a piece first, then its gap', () => {
    const { q, tap, seen } = mount();
    const [, b] = puzzle.gaps as [string, string];
    tap(`[data-piece="${b}"]`);
    expect(q('[data-place-words]').dataset.step).toBe('piece');
    tap(`[data-gap="${b}"]`);
    expect(seen.state.placed).toEqual([b]);
  });

  it('a tray piece speaking never moves the playback bar or the picture to where it is heard', () => {
    const { q, tap } = mount();
    // A piece heard in another line than the one looping.
    const piece = puzzle.gaps.find((g) => lineOf(g) !== scene.lines[0]!.id) ?? puzzle.gaps[0]!;
    const line = scene.lines.find((l) => l.id !== lineOf(piece)) ?? scene.lines[0]!;
    tap(`[data-line-loop="${line.id}"]`);
    const head = q('[data-playhead]').dataset.playhead;
    const now = q('[data-bar-current]')?.dataset.barCurrent;
    const frame = q('[data-slideshow]').dataset.frame;
    tap(`[data-piece="${piece}"]`);
    expect(audio.getState().tag).toBe(`piece:${piece}`);
    expect(audio.getState().startMs).not.toBe(scene.lines.find((l) => l.id === line.id)!.startMs);
    expect(q('[data-playhead]').dataset.playhead).toBe(head);
    expect(q('[data-bar-current]')?.dataset.barCurrent).toBe(now);
    expect(q('[data-slideshow]').dataset.frame).toBe(frame);
    // Placed, it is a box in its line: tapped, it speaks as one (and may move them: it is on screen).
    tap(`[data-gap="${piece}"]`);
    tap(`[data-gap="${piece}"]`);
    expect(audio.getState().tag).toBe(`unit:${piece}`);
  });

  it('a tap on a line loops it; again, the scene plays on from there', () => {
    const { q, tap } = mount();
    const line = scene.lines[1] ?? scene.lines[0]!;
    tap(`[data-line-loop="${line.id}"]`);
    expect(audio.getState().tag).toBe(`line:${line.id}`);
    expect(q(`[data-line="${line.id}"]`).hasAttribute('data-looping')).toBe(true);
    tap(`[data-line-loop="${line.id}"]`);
    expect(audio.getState().tag).toBe(`scene:${scene.id}`);
    expect(q(`[data-line="${line.id}"]`).hasAttribute('data-looping')).toBe(false);
  });
});
