// The view of `say-line`: the whole line loops with its frame; it is shown as tappable boxes; the kid
// says all of it. After each try the boxes heard light up and stay lit; what is missing replays, then
// the whole line. The speaking itself (the microphone control, verdicts, listen-back) is the SpeakPanel.
import { useEffect, useRef } from 'react';
import type { SayLineAction, SayLineState, SayLinePuzzle } from '../../../../shared/puzzles/say-line';
import { t } from '../../../../shared/i18n';
import { audio, useIsPlaying, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { Slideshow } from '../../scene/Slideshow';
import { findLine, tags } from '../../scene/timing';
import { SpeakPanel, TargetStrip, replayMissing, type PlayOriginal } from '../../speech';
import { Icon, cx } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import { useLater } from '../useLater';
import s from './SayLine.module.css';

export function SayLineView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<SayLinePuzzle, SayLineState, SayLineAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const tag = tags.line(line.id);
  const looping = useIsPlaying(tag);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropTake = useRef<(() => void) | null>(null);
  const tablet = practiceCtx.layout === 'tablet';
  const later = useLater();
  useStopAudioOnUnmount();

  const playOriginal: PlayOriginal = (opts = {}) => {
    const { loop = true, ...done } = opts;
    audio.playRange(scene.audio.src, puzzle.startMs, puzzle.endMs, { loop, tag, ...done });
  };

  useEffect(() => {
    playOriginal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const toggle = () => {
    if (btnRef.current) fx.pop(btnRef.current);
    if (looping) audio.stop();
    else {
      dropTake.current?.(); // a take under way first (nothing plays while the microphone is open)
      playOriginal();
    }
  };

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-say-line>
      <div className={s.top}>
        {!tablet && <Slideshow frames={scene.frames} timeMs={puzzle.startMs + 150} className={s.frame} drift={false} />}
        <button ref={btnRef} type="button" className={cx(s.speaker, looping && s.on)} onClick={toggle} aria-label={looping ? t('puzzles.say-line.stop') : t('puzzles.say-line.listen')} data-listen>
          <Icon name={looping ? 'speaker' : 'play'} size={tablet ? 44 : 36} />
        </button>
      </div>
      <p className={s.prompt}>{t('puzzles.say-line.prompt')}</p>
      <TargetStrip scene={scene} line={line} lit={state.lit} compact={!tablet} />
      <SpeakPanel
        query={{ scene: scene.id, line: line.id }}
        maxRecordMs={puzzle.maxRecordMs}
        state={state}
        dispatch={dispatch}
        playOriginal={playOriginal}
        originalMs={puzzle.endMs - puzzle.startMs}
        onMiss={(lit) => replayMissing(scene, line, undefined, lit, () => playOriginal({ loop: true }), later)}
        practiceCtx={practiceCtx}
        dropTake={dropTake}
      />
    </div>
  );
}
