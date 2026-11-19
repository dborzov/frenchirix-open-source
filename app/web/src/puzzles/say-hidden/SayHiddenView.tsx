// The view of `say-hidden`: the scene's frame (memory anchor), the English big in a balloon, and
// under it the French as letter tiles: the first letter(s) printed, a dot per hidden letter, spaces,
// apostrophes and hyphens kept. The kid says it; on a pass (or when the round ends otherwise) the
// tiles flip open one by one and the unit loops. "Listen" replays the unit (a hint, counted once);
// the help strip is closed behind the shell's help button.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MASK_CHAR, type SayHiddenAction, type SayHiddenState, type SayHiddenPuzzle } from '../../../../shared/puzzles/say-hidden';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { Slideshow } from '../../scene/Slideshow';
import { tags } from '../../scene/timing';
import { SpeakPanel, type PlayOriginal } from '../../speech';
import { Balloon, Button, cx } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './SayHidden.module.css';

/** Characters grouped into words (split on spaces), keeping each character's index. */
function words(chars: string[]): { c: string; i: number }[][] {
  const out: { c: string; i: number }[][] = [[]];
  chars.forEach((c, i) => {
    if (c === ' ') out.push([]);
    else out[out.length - 1]!.push({ c, i });
  });
  return out.filter((w) => w.length);
}

export function SayHiddenView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<SayHiddenPuzzle, SayHiddenState, SayHiddenAction>) {
  const tag = tags.unit(puzzle.unitId);
  const looping = useIsPlaying(tag);
  const hinted = useRef(false);
  const tilesRef = useRef<HTMLDivElement>(null);
  const dropTake = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const tablet = practiceCtx.layout === 'tablet';
  useStopAudioOnUnmount();

  const playOriginal: PlayOriginal = (opts = {}) => {
    const { loop = true, ...done } = opts;
    audio.playRange(scene.audio.src, puzzle.startMs, puzzle.endMs, { loop, tag, ...done });
  };

  // Once the round is over the answer shows and loops (re-exposure), whatever ended it.
  useEffect(() => {
    if (state.done && !open) {
      setOpen(true);
      if (state.done !== 'passed') playOriginal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  const listen = (el: HTMLElement) => {
    fx.pop(el);
    if (looping) {
      audio.stop();
      return;
    }
    if (!hinted.current && !state.done) {
      hinted.current = true;
      practiceCtx.hint();
    }
    dropTake.current?.(); // a take under way first (nothing plays while the microphone is open)
    playOriginal();
  };

  const letters = [...puzzle.fr];
  // Mask word groups are the whitespace-separated pieces: the same as the server's expected words.
  const heardWord = (wi: number) => !!state.lit[wi];
  const mask = [...puzzle.mask];
  let k = 0;
  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-say-hidden>
      {!tablet && <Slideshow frames={scene.frames} timeMs={puzzle.frameMs + 80} className={s.frame} drift={false} />}
      <p className={s.prompt}>{t('puzzles.say-hidden.prompt')}</p>
      <Balloon tail="bottom" tailAt="30%" boxy className={s.en} data-en data-speak-keep>
        {puzzle.en}
      </Balloon>
      <div ref={tilesRef} className={cx(s.tiles, open && s.open)} aria-label={open ? puzzle.fr : t('puzzles.say-hidden.letters', { n: letters.filter((c) => /[\p{L}\p{N}]/u.test(c)).length })} data-mask={puzzle.mask} data-speak-keep>
        {words(letters).map((w, wi) => (
          // A word heard in any try opens already (partial credit that builds).
          <span key={wi} className={cx(s.wordGroup, !open && heardWord(wi) && s.open)}>
            {w.map(({ c, i }) => {
              const isLetter = /[\p{L}\p{N}]/u.test(c);
              if (!isLetter) return <span key={i} className={s.punct}>{c}</span>;
              const hidden = mask[i] === MASK_CHAR;
              const n = k++;
              return (
                <span key={i} className={cx(s.tile, !hidden && s.shown)} style={{ '--k': n } as CSSProperties}>
                  <span className={s.face}>{open || !hidden || heardWord(wi) ? c : ''}</span>
                </span>
              );
            })}
          </span>
        ))}
      </div>
      <div className={s.tools}>
        <Button size="sm" color={looping ? 'yellow' : 'white'} icon={looping ? 'stop' : 'speaker'} onClick={(e) => listen(e.currentTarget)} data-listen>
          {t('puzzles.say-hidden.listen')}
        </Button>
      </div>
      <SpeakPanel
        query={{ scene: scene.id, unit: puzzle.unitId }}
        maxRecordMs={puzzle.maxRecordMs}
        state={state}
        dispatch={dispatch}
        playOriginal={playOriginal}
        originalMs={puzzle.endMs - puzzle.startMs}
        practiceCtx={practiceCtx}
        onPass={() => setOpen(true)}
        dropTake={dropTake}
        // What is still to say stays masked like the tiles (first letters), never spelled out.
        showMissing={(word, i) => puzzle.mask.split(' ').filter(Boolean)[i] ?? word.replace(/[\p{L}\p{N}]/gu, MASK_CHAR)}
      />
    </div>
  );
}
