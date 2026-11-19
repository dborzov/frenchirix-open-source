// The view of `act-line`: the scene plays up to the kid's line (the line or two before light up word
// by word), then "À TOI !" slams in with the character's name; the microphone opens by itself (after
// the first permission) and closes on silence; the kid's line is shown as boxes that light up as they
// are heard, and stay lit across tries (a long line can be finished piece by piece). On a pass the
// scene goes on with the next line. The first line of a scene has no line before: the cue comes at
// once; the last has no line after.
import { useEffect, useRef, useState } from 'react';
import type { ActLineAction, ActLineState, ActLinePuzzle } from '../../../../shared/puzzles/act-line';
import { t } from '../../../../shared/i18n';
import { audio, onceDone, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { Slideshow } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { CantSpeak, SpeakPanel, TargetStrip, replayMissing, type PlayOriginal } from '../../speech';
import { Burst, Button, cx } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import { useLater } from '../useLater';
import s from './ActLine.module.css';

type Phase = 'before' | 'cue' | 'turn' | 'after';

export function ActLineView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<ActLinePuzzle, ActLineState, ActLineAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const before = puzzle.beforeIds.map((id) => findLine(scene, id)!).filter(Boolean);
  const after = puzzle.afterId ? findLine(scene, puzzle.afterId) : undefined;
  const tablet = practiceCtx.layout === 'tablet';
  const [phase, setPhase] = useState<Phase>(before.length ? 'before' : 'cue');
  const [autoKey, setAutoKey] = useState(0);
  // Once the kid's turn has come, the speaking panel stays mounted (« Réécouter la scène » replays the
  // lines before under it): remounting it lost the kid's take and the count of takes with no voice.
  const [turned, setTurned] = useState(false);
  const cueRef = useRef<HTMLDivElement>(null);
  const dropTake = useRef<(() => void) | null>(null);
  const turnRef = useRef<HTMLDivElement>(null);
  useStopAudioOnUnmount();
  const later = useLater(); // delayed steps die with the puzzle

  const tag = tags.line(line.id);
  const playOriginal: PlayOriginal = (opts = {}) => {
    const { loop = false, ...done } = opts;
    const w = lineWindow(line);
    audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop, tag, ...done });
  };

  const cue = () => {
    setPhase('cue');
    fx.sfx('pop');

    later(() => {
      setPhase('turn');
      setTurned(true);
      setAutoKey((k) => k + 1); // the microphone opens by itself
      // The kid's line and the microphone come into view (a long scene pane scrolls on a phone).
      requestAnimationFrame(() => turnRef.current?.scrollIntoView({ block: 'start', behavior: fx.reducedMotion() ? 'auto' : 'smooth' }));
    }, 900);
  };

  /** The scene up to the kid's line. */
  const playBefore = () => {
    if (!before.length) {
      cue();
      return;
    }
    setPhase('before');
    const a = lineWindow(before[0]!).startMs;
    const b = lineWindow(before[before.length - 1]!).endMs;
    // The kid's turn comes once: when the lines end, fail to load, or never report their end (a stalled
    // load, a tapped box that took the voice).
    audio.playRange(scene.audio.src, a, b, { loop: false, tag: tags.line(before[0]!.id), ...onceDone(() => later(cue, 250), b - a, later) });
  };

  useEffect(() => {
    later(playBefore, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  // The kid's line is done: the scene goes on.
  useEffect(() => {
    if (state.done !== 'passed' && state.done !== 'listened') return;
    later(() => {
      setPhase('after');
      if (after) {
        const w = lineWindow(after);
        audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag: tags.line(after.id) });
      } else playOriginal();
    }, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  const restMs = lineWindow(line).startMs + 150;
  const name = line.speaker;
  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-act-line data-phase={phase}>
      {!tablet && <Slideshow frames={scene.frames} audioSrc={scene.audio.src} restMs={restMs} className={s.frame} alt={scene.titleFr} />}

      {before.length > 0 && (
        <div className={cx(s.lines, phase !== 'before' && s.dim)} data-before>
          <DialogueStrip scene={scene} lineIds={before.map((l) => l.id)} compact linePlay={false} />
        </div>
      )}

      <div ref={turnRef} className={s.turn}>
        <div className={s.role}>
          <span className={s.roleTag}>{name ? t('puzzles.act-line.you', { name }) : t('puzzles.act-line.youNoName')}</span>
          {phase === 'cue' && (
            <div ref={cueRef} className={s.cue} aria-live="assertive">
              <Burst size={tablet ? 150 : 120} color="yellow" rotate={-8} pop>
                {t('puzzles.act-line.cue')}
              </Burst>
            </div>
          )}
        </div>
        <TargetStrip scene={scene} line={line} lit={state.lit} active={phase === 'turn' && state.done === null} compact={!tablet} />
      </div>

      {after && (phase === 'after' || state.done) && (
        <div className={s.lines} data-after>
          <span className={s.then}>{t('puzzles.act-line.next')}</span>
          <DialogueStrip scene={scene} lineIds={[after.id]} compact linePlay={false} />
        </div>
      )}

      {phase === 'before' && turned && <p className={s.listen}>{t('puzzles.act-line.listen')}</p>}
      {phase === 'before' && !turned ? (
        <>
          {/* "Je ne peux pas parler" at every step, the scene before the kid's turn included. */}
          <CantSpeak practiceCtx={practiceCtx} />
          <p className={s.listen}>{t('puzzles.act-line.listen')}</p>
        </>
      ) : (
        <>
          {/* Right above the microphone control (and « Je ne peux pas parler »): in view whenever the
              control is, which scrolls itself into view while it listens. */}
          {state.done === null && phase === 'turn' && before.length > 0 && (
            // A take under way is dropped first: the scene would play into it (and nothing plays while
            // the microphone is open); the microphone opens again by itself after the lines.
            <Button size="sm" color="white" icon="loop" className={s.replay} onClick={() => { dropTake.current?.(); playBefore(); }} data-act-replay>
              {t('puzzles.act-line.replay')}
            </Button>
          )}
          <SpeakPanel
            query={{ scene: scene.id, line: line.id }}
            maxRecordMs={puzzle.maxRecordMs}
            silenceMs={1800}
            state={state}
            dispatch={dispatch}
            playOriginal={playOriginal}
            originalMs={lineWindow(line).endMs - lineWindow(line).startMs}
            onMiss={(lit) => replayMissing(scene, line, undefined, lit, () => playOriginal(), later)}
            autoStartKey={autoKey}
            dropTake={dropTake}
            practiceCtx={practiceCtx}
          />
        </>
      )}
    </div>
  );
}
