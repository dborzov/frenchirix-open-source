// A play a view waits on before its next step, continued exactly once: on the play's end, on its
// error, or on a safety timer, whichever comes first (docs/app-games.md, "Every wait has an end").
// A clip can fail to load, a load can stall and never finish, and a play that is stopped or replaced
// (another sound took the one voice, a tapped box) never reports its end: waiting on onEnd alone
// leaves the puzzle stuck.
//
//   audio.playRange(src, a, b, { loop: false, tag, ...onceDone(() => next(), b - a, later) });
//
// `later(fn, ms)` is the view's own timer, returning its handle (useLater, or one the view clears on
// Pause), so the safety timer dies with the view and never starts a step on a puzzle that is gone. It
// is cleared once the play has ended, so nothing stays pending.
import type { PlayOptions } from './engine';

/** How long past a play's own length the view waits for its end before going on without it. */
export const PLAY_SLACK_MS = 2500;

export function onceDone(then: () => void, playMs: number, later: (fn: () => void, ms: number) => number): Required<Pick<PlayOptions, 'onEnd' | 'onError'>> {
  let went = false;
  const go = () => {
    if (went) return;
    went = true;
    window.clearTimeout(timer);
    then();
  };
  const timer = later(go, Math.max(0, playMs) + PLAY_SLACK_MS);
  return { onEnd: go, onError: go };
}
