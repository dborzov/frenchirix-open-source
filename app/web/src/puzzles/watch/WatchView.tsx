// The view of `watch`: the scene plays once through with the slideshow and the strip, the current
// word lighting up; the kid can tap boxes any time. When it has played through (or most of it),
// the puzzle is done and the shell shows its "continue" bar.
import { useEffect, useRef } from 'react';
import type { WatchAction, WatchState, WatchPuzzle } from '../../../../shared/puzzles/watch';
import { ScenePlayer } from '../../scene/ScenePlayer';
import type { PuzzleViewProps } from '../registry';

/** Share of the scene that counts as "watched". */
export const WATCHED_SHARE = 0.85;

export function WatchView({ puzzle, state, dispatch, scene }: PuzzleViewProps<WatchPuzzle, WatchState, WatchAction>) {
  const done = useRef(state.done);
  done.current = state.done;
  const finish = () => {
    if (!done.current) {
      done.current = true;
      dispatch({ kind: 'ended' });
    }
  };

  // Safety net: if the audio cannot play at all (locked, failed), let the kid through after the
  // scene's length plus a little.
  useEffect(() => {
    const id = window.setTimeout(finish, scene.audio.durationMs + 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  return (
    <ScenePlayer
      scene={scene}
      lineIds={puzzle.helpLineIds}
      loop={false}
      autoPlay
      onEnded={finish}
      onProgress={(ms) => {
        if (ms >= scene.audio.durationMs * WATCHED_SHARE) finish();
      }}
    />
  );
}
