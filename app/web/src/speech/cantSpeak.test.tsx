// "Je ne peux pas parler" at every step of the speaking puzzles (the user's rule): the steps the
// shared SpeakPanel does not cover, in act-line (the scene before the kid's turn) and say-chain (the
// microphone's own notices, where it must come first so it stays in view on a phone).
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../../../shared/practice/rng';
import type { BuildCtx } from '../../../shared/practice/types';
import { FIXTURE_INDEX } from '../../../shared/fixtures';
import { FIXTURE_SCENE } from '../../../shared/fixtures/scene';
import { actLine } from '../../../shared/puzzles/act-line';
import { sayChain } from '../../../shared/puzzles/say-chain';
import { ActLineView } from '../puzzles/act-line/ActLineView';
import { SayChainView } from '../puzzles/say-chain/SayChainView';
import type { PracticeCtx } from '../puzzles/registry';

const scene = FIXTURE_SCENE;
const ctx = (extra: Partial<BuildCtx> = {}): BuildCtx => ({ scene, level: 3, rng: createRng(1), focusUnitIds: new Set(), others: [], bank: FIXTURE_INDEX.bank, usedLineIds: new Set(), usedUnitIds: new Set(), ...extra });
const practiceCtx = (setSpeak = vi.fn()): PracticeCtx => ({ practiceId: 'l', puzzleIndex: 0, puzzleCount: 1, layout: 'phone', speak: true, openHelp: () => {}, hint: () => {}, next: () => {}, setSpeak });

describe('"Je ne peux pas parler" at every step', () => {
  it('act-line: while the lines before the kid\'s turn play', () => {
    const line = scene.lines.find((_, i) => i > 0)!;
    const puzzle = actLine.build(ctx({ targetLineId: line.id }));
    expect(puzzle?.beforeIds.length).toBeGreaterThan(0);
    const setSpeak = vi.fn();
    const { container } = render(<ActLineView puzzle={puzzle!} state={actLine.init(puzzle!)} dispatch={() => {}} scene={scene} practiceCtx={practiceCtx(setSpeak)} />);
    expect(container.querySelector('[data-act-line]')?.getAttribute('data-phase')).toBe('before');
    const cant = container.querySelector<HTMLButtonElement>('[data-cant-speak]');
    expect(cant).not.toBeNull();
    act(() => cant!.click());
    expect(setSpeak).toHaveBeenCalledWith(false);
  });

  it('say-chain: before the microphone notice (first in the page), not under it', () => {
    const puzzle = sayChain.build(ctx());
    expect(puzzle).not.toBeNull();
    const { container } = render(<SayChainView puzzle={puzzle!} state={sayChain.init(puzzle!)} dispatch={() => {}} scene={scene} practiceCtx={practiceCtx()} />);
    // No microphone in this test environment: the notice shows at once, with the button above it.
    const notice = container.querySelector('[data-mic-intro], [data-mic-denied]');
    const cant = container.querySelector('[data-cant-speak]');
    expect(notice).not.toBeNull();
    expect(cant).not.toBeNull();
    expect(cant!.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
