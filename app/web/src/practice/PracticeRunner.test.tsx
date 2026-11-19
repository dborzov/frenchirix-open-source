// Save, then continue (docs/app-games.md, "The practice screen"): a finished puzzle's save is sent
// once; the kid moves on only once it is saved; a failed save shows the panel, « Réessayer » sends it
// again and moves on; the completion works the same; practice-closed shows the results as already
// saved; a crash inside a puzzle view is caught around the puzzle and « Réessayer » remounts it.
// Where am I: the header names the level the practice is for (or « Rejouer »), the track shows
// « Défi n sur N » and how many are left; « Je continue plus tard » leaves with the finished count.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeCompleteResponse } from '../../../shared/api';
import { setLanguage, translate } from '../../../shared/i18n';
import type { Scene } from '../../../shared/content';
import type { Practice, PuzzleBase } from '../../../shared/practice/types';
import { ApiRequestError } from '../api/errors';
import type { PuzzleViewProps } from '../puzzles/registry';
import { PracticeRunner, type PuzzleProgress } from './PracticeRunner';

const recovered = vi.hoisted(() => ({ refresh: vi.fn(async () => true), recover: vi.fn(() => true) }));
vi.mock('../state/recover', () => ({ refreshState: recovered.refresh, recover: recovered.recover }));

// One fake puzzle type: a button finishes it. A puzzle whose id ends in `crash` throws while `crashes.on`
// (React renders a throwing component twice before it gives up to the boundary).
const crashes = vi.hoisted(() => ({ on: false }));
vi.mock('../puzzles/registry', () => {
  const logic = {
    type: 'fake',
    meta: { needsMic: false },
    init: () => ({ done: false }),
    reduce: (_p: unknown, _s: unknown, a: { kind: string }) => ({ done: a.kind === 'solve' }),
    isDone: (_p: unknown, s: { done: boolean }) => s.done,
    mistakes: () => 0,
    missedUnitIds: () => [],
    solve: () => ({ kind: 'solve' }),
  };
  function View({ puzzle, state, dispatch }: PuzzleViewProps<PuzzleBase, { done: boolean }, { kind: string }>) {
    if (puzzle.id.endsWith('crash') && crashes.on) throw new Error('the view broke');
    return (
      <button type="button" data-solve={puzzle.id} disabled={state.done} onClick={() => dispatch({ kind: 'solve' })}>
        solve
      </button>
    );
  }
  return { getPuzzleEntry: (type: string) => (type === 'fake' ? { logic, View, help: 'none' } : undefined) };
});

const scene = { id: 's1', thumb: '', titleFr: 'Scène', frames: [], audio: { src: '', durationMs: 1000 }, lines: [] } as unknown as Scene;
const scenes = new Map([[scene.id, scene]]);
const practiceOf = (...ids: string[]): Practice => ({ id: 'P', seed: 1, kind: 'scene', entries: [{ sceneId: 's1', level: 1, due: true }], puzzles: ids.map((id) => ({ id, type: 'fake', sceneId: 's1', helpLineIds: [], unitIds: [] })) });
const completeRes = { stars: 3, rewards: { xp: 12, sesterces: 0 }, levels: [], replayed: [], streak: { count: 1, extended: true, freezesUsed: 0 }, achievements: [], chest: null, patch: {} } as unknown as PracticeCompleteResponse;

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

function mount(practice: Practice, props: { onPuzzleDone?: (p: PuzzleProgress) => Promise<unknown>; complete?: () => Promise<PracticeCompleteResponse>; onExit?: (done: number) => void; level?: number; replay?: boolean } = {}) {
  const onFinish = vi.fn();
  const r = render(
    <PracticeRunner practice={practice} scenes={scenes} speak={false} level={props.level} replay={props.replay} onPuzzleDone={props.onPuzzleDone} complete={props.complete ?? (async () => completeRes)} onExit={props.onExit ?? (() => {})} onFinish={onFinish} />,
  );
  const q = (sel: string) => r.container.querySelector<HTMLElement>(sel);
  const shown = () => q('[data-puzzle]')?.getAttribute('data-puzzle') ?? null;
  const tap = (sel: string) => act(() => q(sel)!.click());
  return { ...r, q, shown, tap, onFinish };
}

describe('save, then continue', () => {
  beforeEach(() => {
    setLanguage('fr'); // the texts below are the French interface's
    recovered.refresh.mockClear();
    recovered.recover.mockClear();
    crashes.on = false;
  });
  // Unmount after each test (vitest runs without globals, so Testing Library does not do it by itself):
  // the runner clears its timers on unmount, so none fires after the page is torn down.
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sends the save when the puzzle is done; « Continuer » waits for it; a failure blocks; « Réessayer » sends it again and moves on', async () => {
    const saves: ReturnType<typeof deferred>[] = [];
    const sent: PuzzleProgress[] = [];
    const onPuzzleDone = vi.fn((p: PuzzleProgress) => {
      sent.push(p);
      const d = deferred();
      saves.push(d);
      return d.promise;
    });
    const ui = mount(practiceOf('p0', 'p1', 'p2'), { onPuzzleDone });
    expect(ui.shown()).toBe('p0');
    await ui.tap('[data-solve="p0"]');
    // Sent at once, with the finished count and the outcome.
    expect(onPuzzleDone).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({ done: 1, total: 3, outcome: { puzzleId: 'p0' } });
    // « Continuer » while the save is under way: still here, the button busy.
    await ui.tap('[data-continue] [data-next]');
    expect(ui.shown()).toBe('p0');
    expect(ui.q('[data-continue] [data-next]')!.getAttribute('aria-busy')).toBe('true');
    // The save fails: the panel over the continue bar, with the detail line; nothing moved.
    await act(async () => saves[0]!.reject(new ApiRequestError(500, 'internal', undefined, undefined, { method: 'POST', path: '/api/practices/P/progress' })));
    await flush();
    expect(ui.shown()).toBe('p0');
    expect(ui.q('[data-save-failed] [data-error-panel]')).not.toBeNull();
    expect(ui.q('[data-continue] [data-next]')).toBeNull();
    expect(ui.q('[data-error-detail]')!.textContent).toMatch(/^FRX-ERR server 500 POST \/api\/practices\/P\/progress/);
    expect(recovered.recover).toHaveBeenCalledTimes(1);
    // « Réessayer »: sent once more; once saved, on to the next puzzle.
    await ui.tap('[data-error-retry]');
    expect(onPuzzleDone).toHaveBeenCalledTimes(2);
    expect(sent[1]).toMatchObject({ done: 1, outcome: { puzzleId: 'p0' } });
    expect(ui.shown()).toBe('p0');
    await act(async () => saves[1]!.resolve(undefined));
    await flush();
    expect(ui.shown()).toBe('p1');
    expect(ui.q('[data-save-failed]')).toBeNull();
    // Saved before the tap: « Continuer » goes at once. Nothing is ever sent twice behind the kid's back.
    await ui.tap('[data-solve="p1"]');
    await act(async () => saves[2]!.resolve(undefined));
    await flush();
    await ui.tap('[data-continue] [data-next]');
    expect(ui.shown()).toBe('p2');
    expect(onPuzzleDone).toHaveBeenCalledTimes(3);
  });

  it('the last puzzle completes the practice: the results show once saved; a failed completion shows the panel', async () => {
    const tries: ReturnType<typeof deferred<PracticeCompleteResponse>>[] = [];
    const complete = vi.fn(() => {
      const d = deferred<PracticeCompleteResponse>();
      tries.push(d);
      return d.promise;
    });
    const onPuzzleDone = vi.fn(async () => {});
    const ui = mount(practiceOf('p0', 'p1'), { onPuzzleDone, complete });
    await ui.tap('[data-solve="p0"]');
    await flush();
    await ui.tap('[data-continue] [data-next]');
    await ui.tap('[data-solve="p1"]');
    // The last puzzle sends the completion, not a progress save.
    expect(onPuzzleDone).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    await ui.tap('[data-continue] [data-next]');
    await act(async () => tries[0]!.reject(new ApiRequestError(0, 'offline')));
    await flush();
    expect(ui.q('[data-results]')).toBeNull();
    expect(ui.q('[data-save-failed] [data-error-panel]')!.getAttribute('data-error-kind')).toBe('offline');
    await ui.tap('[data-error-retry]');
    expect(complete).toHaveBeenCalledTimes(2);
    await act(async () => tries[1]!.resolve(completeRes));
    await flush();
    expect(ui.q('[data-results]')).not.toBeNull();
    expect(ui.q('[data-already-saved]')).toBeNull();
    await ui.tap('[data-results-continue]');
    expect(ui.onFinish).toHaveBeenCalledWith(completeRes);
  });

  it('practice-closed (finished elsewhere, or the answer to an earlier try got lost): the results as already saved, never « Oups »', async () => {
    const ui = mount(practiceOf('p0', 'p1', 'p2'), { onPuzzleDone: async () => Promise.reject(new ApiRequestError(409, 'practice-closed')) });
    await ui.tap('[data-solve="p0"]');
    await flush();
    expect(ui.q('[data-results]')).not.toBeNull();
    expect(ui.q('[data-already-saved]')).not.toBeNull();
    expect(ui.q('[data-error-panel]')).toBeNull();
    expect(recovered.refresh).toHaveBeenCalledTimes(1);
    await ui.tap('[data-results-continue]');
    expect(ui.onFinish).toHaveBeenCalledWith(null);
  });

  it('a practice opened with every puzzle done completes at once', async () => {
    const complete = vi.fn(async () => completeRes);
    const r = render(<PracticeRunner practice={practiceOf('p0')} scenes={scenes} speak={false} startAt={{ puzzleIndex: 1, outcomes: [], ms: 0 }} complete={complete} onExit={() => {}} onFinish={() => {}} />);
    await flush();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(r.container.querySelector('[data-results]')).not.toBeNull();
  });

  it('where am I: the level the practice is for, « Défi n sur N » and how many are left, as the kid goes on', async () => {
    const ui = mount(practiceOf('p0', 'p1', 'p2'), { onPuzzleDone: async () => {}, level: 2 });
    const bar = () => ui.q('[role="progressbar"]')!;
    const left = () => ui.q('[data-left]')!;
    expect(ui.q('[data-level-tag]')!.getAttribute('data-level-tag')).toBe('2');
    expect(ui.q('[data-level-tag]')!.textContent).toBe('Argent');
    expect(ui.q('[data-where]')!.textContent).toContain('Scène');
    expect(bar().textContent).toBe('Défi 1 sur 3');
    expect(bar().getAttribute('aria-valuenow')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('3');
    expect(left().textContent).toBe('Encore 3');
    // Done: the bar counts it at once, before « Continuer ».
    await ui.tap('[data-solve="p0"]');
    await flush();
    expect(bar().getAttribute('aria-valuenow')).toBe('1');
    expect(left().textContent).toBe('Encore 2');
    await ui.tap('[data-continue] [data-next]');
    expect(bar().textContent).toBe('Défi 2 sur 3');
    await ui.tap('[data-solve="p1"]');
    await flush();
    await ui.tap('[data-continue] [data-next]');
    expect(bar().textContent).toBe('Défi 3 sur 3');
    expect(left().textContent).toBe('Le dernier\u00a0!');
  });

  it('a replay says « Rejouer »; without props the level comes from the practice; continuing starts at the saved puzzle', async () => {
    const replay = mount(practiceOf('p0'), { replay: true });
    expect(replay.q('[data-level-tag]')!.getAttribute('data-level-tag')).toBe('replay');
    expect(replay.q('[data-level-tag]')!.textContent).toBe('Rejouer');
    cleanup();
    const r = render(<PracticeRunner practice={practiceOf('p0', 'p1', 'p2', 'p3')} scenes={scenes} speak={false} startAt={{ puzzleIndex: 2, outcomes: [], ms: 0 }} complete={async () => completeRes} onExit={() => {}} onFinish={() => {}} />);
    expect(r.container.querySelector('[data-level-tag]')!.getAttribute('data-level-tag')).toBe('1');
    expect(r.container.querySelector('[data-puzzle]')!.getAttribute('data-puzzle')).toBe('p2');
    expect(r.container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('2');
    expect(r.container.querySelector('[role="progressbar"]')!.textContent).toBe('Défi 3 sur 4');
  });

  it('« Je continue plus tard » leaves at any puzzle with the count of finished puzzles; « Je joue encore » stays', async () => {
    const onExit = vi.fn();
    const ui = mount(practiceOf('p0', 'p1', 'p2'), { onPuzzleDone: async () => {}, onExit });
    await ui.tap('[data-solve="p0"]');
    await flush();
    await ui.tap('[data-continue] [data-next]');
    await ui.tap('[data-practice-close]');
    expect(document.body.textContent).toContain(translate('fr', 'practice.exit.textSaved'));
    await act(() => (document.querySelector('[data-exit-stay]') as HTMLElement).click());
    expect(onExit).not.toHaveBeenCalled();
    expect(ui.shown()).toBe('p1');
    await ui.tap('[data-practice-close]');
    const leave = document.querySelector('[data-exit-leave]') as HTMLElement;
    expect(leave.textContent).toBe('Je continue plus tard');
    await act(() => leave.click());
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it('the results: the quest it did and its chest, a full streak; the button opens the chest', async () => {
    const chest = { id: 'c1', kind: 'wood', source: 'quest', earnedDay: '2026-11-14' };
    const res = { ...completeRes, level: 2, replay: false, quest: { index: 0, chest }, chest, streak: { count: 2, extended: true, freezesUsed: 0, reset: false, full: true } } as unknown as PracticeCompleteResponse;
    const ui = mount(practiceOf('p0'), { complete: async () => res, level: 2 });
    await ui.tap('[data-solve="p0"]');
    await flush();
    await ui.tap('[data-continue] [data-next]');
    await flush();
    expect(ui.q('[data-results] [data-level-tag]')!.getAttribute('data-level-tag')).toBe('2');
    expect(ui.q('[data-quest-done]')).not.toBeNull();
    expect(ui.q('[data-full-streak]')).not.toBeNull();
    expect(ui.q('[data-results-continue]')!.textContent).toBe('Ouvre ton coffre\u00a0!');
    await ui.tap('[data-results-continue]');
    expect(ui.onFinish).toHaveBeenCalledWith(res);
  });

  it('a crash inside the puzzle view is caught around the puzzle; « Réessayer » remounts it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    crashes.on = true;
    const onExit = vi.fn();
    const ui = mount(practiceOf('p0crash', 'p1'), { onPuzzleDone: async () => {}, onExit });
    // The shell is still there (header, progress), only the puzzle shows the panel.
    expect(ui.q('[data-practice-close]')).not.toBeNull();
    expect(ui.q('[data-puzzle-pane] [data-error-panel]')!.textContent).toMatch(/Ce défi s’est bloqué/);
    expect(ui.q('[data-error-detail]')!.textContent).toMatch(/^FRX-ERR crash \/practice\/P p0crash "Error: the view broke"/);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).startsWith('[frx] crash'))).toBe(true);
    crashes.on = false;
    await ui.tap('[data-error-retry]');
    expect(ui.q('[data-solve="p0crash"]')).not.toBeNull();
    await ui.tap('[data-solve="p0crash"]');
    await flush();
    await ui.tap('[data-continue] [data-next]');
    expect(ui.shown()).toBe('p1');
  });
});
