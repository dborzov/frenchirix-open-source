// The view of `say-choice`: the moment of the scene, the line before plays, then three speech
// balloons: the real line and two funny alternates, each tappable piece by piece for its meaning and
// playable. The kid says one aloud; the server tells which (POST /api/speech?choice=<line>). That
// balloon wins and slams onto the picture with a reaction (funnier for the funny ones), the others pop,
// and the scene goes on with the next line. No wrong choice: after a first unrecognised try each
// balloon also gets a "Celle-là !" button; on the third try the closest one wins. A take with no voice
// is no try ("I didn't hear anything", the microphone again). The microphone control sits in a sticky
// dock under the balloons; whenever the dock grows (a note, the listening control) the balloons are
// scrolled back above it.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLater } from '../useLater';
import type { ChoiceOption, SayChoiceAction, SayChoiceState, SayChoicePuzzle } from '../../../../shared/puzzles/say-choice';
import { canTap, sayChoice } from '../../../../shared/puzzles/say-choice';
import { t, type TKey } from '../../../../shared/i18n';
import { audio, useAudioState, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { closeGlosses, GlossText } from '../../scene/GlossText';
import { DialogueStrip } from '../../scene/DialogueStrip';
import { Slideshow } from '../../scene/Slideshow';
import { findLine, lineWindow, tags } from '../../scene/timing';
import { askSpeech, CantSpeak, isNotice, MicControl, MicNotice, useRecorder, type Take } from '../../speech';
import { Balloon, Icon, Spinner, cx } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './SayChoice.module.css';

const FUNNY: TKey[] = ['puzzles.say-choice.funny1', 'puzzles.say-choice.funny2', 'puzzles.say-choice.funny3'];

export function SayChoiceView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<SayChoicePuzzle, SayChoiceState, SayChoiceAction>) {
  const line = findLine(scene, puzzle.lineId)!;
  const prev = puzzle.beforeId ? findLine(scene, puzzle.beforeId) : undefined;
  const next = puzzle.afterId ? findLine(scene, puzzle.afterId) : undefined;
  const tablet = practiceCtx.layout === 'tablet';
  const [sending, setSending] = useState(false);
  const [reaction, setReaction] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const balloonRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const st = useAudioState();
  const done = state.chosen !== null;
  useStopAudioOnUnmount();
  const later = useLater(); // delayed plays die with the puzzle

  // The three balloons and the microphone in view: on a phone the picture and the line before push
  // them under the microphone dock, where a kid cannot read them.
  const endRef = useRef<HTMLDivElement>(null);
  const showChoices = () => endRef.current?.scrollIntoView({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });

  // The line before plays first (the cue for the choice); then the choices come into view.
  useEffect(() => {
    const w = prev ? lineWindow(prev) : null;
    if (prev && w) audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag: tags.line(prev.id) });
    // By the clock, not the audio's end (which never comes while audio is locked).
    later(showChoices, Math.max(900, w ? w.endMs - w.startMs + 300 : 0));
    return () => closeGlosses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const playOption = (o: ChoiceOption) => {
    if (o.k === 0) {
      const w = lineWindow(line);
      audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag: `choice:${o.k}` });
    } else if (o.audio) audio.play(o.audio, { tag: `choice:${o.k}` });
  };

  const win = (k: number) => {
    const idx = puzzle.options.findIndex((o) => o.k === k);
    const el = balloonRefs.current[idx];
    const word = k === 0 ? t('puzzles.say-choice.original') : t(FUNNY[(k + puzzle.options.length) % FUNNY.length]!);
    setReaction(word);
    if (el) {
      fx.right(el);
      setTimeout(() => fx.impact(word, el, { size: 'md' }), 150);
    }
    fx.sfx('win');
    // The scene goes on: the winning line (its own sound), then the next one.
    const o = puzzle.options[idx];
    later(() => {
      if (o) playOption(o);
      if (next) {
        const w = lineWindow(next);
        later(() => audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag: tags.line(next.id) }), o?.k === 0 ? lineWindow(line).endMs - lineWindow(line).startMs + 400 : 2600);
      }
    }, 700);
  };

  const apply = (action: SayChoiceAction) => {
    const after = sayChoice.reduce(puzzle, stateRef.current, action);
    dispatch(action);
    if (after.chosen !== null && stateRef.current.chosen === null) win(after.chosen);
    else if (btnRef.current) fx.wobble(btnRef.current);
  };

  const onTake = async (take: Take) => {
    if (take.problem) {
      // No voice heard (silent, or too short): not sent and no try; the microphone again (after
      // UNHEARD_LIMIT in a row, the microphone's notice with skip).
      URL.revokeObjectURL(take.url);
      setHeard('');
      if (btnRef.current) fx.wobble(btnRef.current);
      return;
    }
    setSending(true);
    const r = await askSpeech({ scene: scene.id, choice: line.id, attempt: stateRef.current.tries + 1 }, take.wav);
    setSending(false);
    URL.revokeObjectURL(take.url);
    if ('error' in r) {
      apply({ kind: 'unavailable' });
      return;
    }
    const c = r.res.choice;
    const scores = c?.scores ?? [];
    let closest = 0;
    scores.forEach((v, i) => {
      if (v > (scores[closest] ?? -1)) closest = i;
    });
    setHeard(r.res.transcript);
    apply({ kind: 'said', index: r.res.pass && c ? c.index : null, closest });
  };
  const rec = useRecorder((take) => void onTake(take));

  const press = () => {
    if (done || sending || rec.status !== 'idle') return;
    closeGlosses();
    audio.stop();
    setHeard(null);
    rec.record(puzzle.maxRecordMs);
  };

  const notice = isNotice(rec.status);
  const listening = rec.status === 'recording';
  // The dock grew (a note after a try, the listening control): the balloons back above it, so it never covers the third.
  useEffect(() => {
    if (done || (heard === null && !listening)) return;
    const id = requestAnimationFrame(showChoices);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, listening, done]);
  const tapping = canTap(state);
  const w = lineWindow(line);
  return (
    <div className={cx(s.puzzle, tablet && s.tablet, done && s.over, listening && s.listening)} data-say-choice>
      {!tablet && <Slideshow frames={scene.frames} audioSrc={scene.audio.src} restMs={w.startMs + 150} className={s.frame} alt={scene.titleFr} />}
      {prev && (
        <div className={s.prev}>
          <DialogueStrip scene={scene} lineIds={[prev.id]} compact linePlay />
        </div>
      )}
      <p className={s.prompt}>{t('puzzles.say-choice.prompt')}</p>
      <div className={s.balloons}>
        {puzzle.options.map((o, i) => {
          const won = state.chosen === o.k;
          const playing = st.playing && st.tag === `choice:${o.k}`;
          return (
            <div
              key={o.k}
              ref={(el) => {
                balloonRefs.current[i] = el;
              }}
              className={cx(s.balloon, won && s.won, done && !won && s.popped, playing && s.playing)}
              style={{ '--i': i } as CSSProperties}
              data-option={o.k}
            >
              <GlossText fr={o.fr} units={o.units} size={tablet ? 'md' : 'sm'} tone="paper" />
              {won && (
                <span className={s.en} lang="en">
                  {o.en}
                </span>
              )}
              <div className={s.tools}>
                {(o.k === 0 || o.audio) && (
                  <button type="button" className={s.play} onClick={() => playOption(o)} aria-label={playing && st.loading ? t('common.media.busy') : t('puzzles.say-choice.listen')} aria-busy={(playing && st.loading) || undefined} data-option-play={o.k} data-busy={(playing && st.loading) || undefined}>
                    {playing && st.loading ? <Spinner size="sm" /> : <Icon name={playing ? 'speaker' : 'play'} size={22} />}
                  </button>
                )}
                {(tapping || state.mode === 'tap') && !done && (
                  <button type="button" className={s.pick} onClick={() => apply({ kind: 'tap', k: o.k })} data-option-pick={o.k}>
                    {t('puzzles.say-choice.pickThis')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {reaction && done && <p className={s.reaction}>{reaction}</p>}
      {next && done && (
        <div className={s.prev} data-after>
          <DialogueStrip scene={scene} lineIds={[next.id]} compact linePlay />
        </div>
      )}

      {!done && (
        <div className={s.micDock}>
          <CantSpeak practiceCtx={practiceCtx} nudge={rec.unheard >= 2} />
          {notice ? (
            <MicNotice status={rec.status} onOk={rec.acceptIntro} onSkip={() => dispatch({ kind: 'skip' })} onRetry={rec.reset} />
          ) : state.mode === 'speak' ? (
            <div className={s.mic}>
              {heard !== null && !listening && (
                <Balloon tail="bottom" tailAt="50%" boxy className={s.note} data-choice-note={heard ? 'heard' : 'silent'}>
                  {heard ? t('puzzles.speak.heard', { text: heard }) : rec.unheard >= 2 ? t('puzzles.speak.silentAgain') : t('puzzles.speak.silent')}
                  {tapping && <span className={s.orTap}>{t('puzzles.say-choice.orTap')}</span>}
                </Balloon>
              )}
              <MicControl rec={rec} refEl={btnRef} onStart={press} onPause={rec.pause} thinking={sending} idle={state.tries > 0 ? 'again' : 'start'} compact />
            </div>
          ) : (
            <p className={s.orTapAlone}>{t('puzzles.say-choice.orTap')}</p>
          )}
        </div>
      )}
      <div ref={endRef} aria-hidden />
    </div>
  );
}
