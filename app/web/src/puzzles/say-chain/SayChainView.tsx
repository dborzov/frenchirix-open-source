// The view of `say-chain`: five or six words or expressions, hands-free. One tap on the microphone
// (« C'est parti ! ») starts the chain (browsers need a gesture to open the microphone); then for each
// item: it slams in big with its meaning, its model plays once (the microphone control says
// "Listen…", the mic is off), the microphone opens (the control shows it listening, with its meter and
// countdown), closes on a short silence, and the answer comes back ("Checking…"). Heard: a small
// reward and on to the next by itself. Missed: the model again, and the microphone again, by itself.
// The third try always moves on (speak-core rule). Without recognition (503) the item becomes
// listen-back by itself: the kid's voice, then on.
//
// A take with no voice is no try: the chain pauses ("I didn't hear anything") with the microphone off,
// and the kid taps to go on; so the microphone never keeps listening to nobody. Pause, at every running
// step, drops whatever was under way (its timers, the take, a late answer); Continue starts the item
// again from its model. Hiding the page pauses too.
//
// The puzzle's truth (index, tries, results) is the logic's state; this view only drives the loop.
// Every wait has an end (docs/app-games.md): each play it waits on goes on once on its end, its error
// or a timer (onceDone).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChainItem, SayChainAction, SayChainState, SayChainPuzzle } from '../../../../shared/puzzles/say-chain';
import { sayChain } from '../../../../shared/puzzles/say-chain';
import { SPEECH_MAX_TRIES } from '../../../../shared/rules';
import { t } from '../../../../shared/i18n';
import { audio, onceDone, useStopAudioOnUnmount } from '../../audio';
import { fx } from '../../fx';
import { findLine, loopWindowFor, tags } from '../../scene/timing';
import { askSpeech, CantSpeak, isNotice, keepAboveDock, MicControl, MicDock, micDocked, MicNotice, SPEECH_TIMEOUT_MS, useRecorder, type Take } from '../../speech';
import { Icon, cx, unitColorVars } from '../../ui';
import type { PuzzleViewProps } from '../registry';
import s from './SayChain.module.css';

type Step = 'ready' | 'model' | 'listen' | 'think' | 'heard' | 'miss' | 'back' | 'paused' | 'end';
/** Why the chain is paused: the kid's Pause (or the page hidden), or a take with no voice. */
type PauseWhy = 'pause' | 'silent' | 'short';

const SILENCE_MS = 700; // end of speech for one short word
const DRILL_MS = 17_500; // a v1 drill's length is not known (5 to 18 s): wait as for the longest

export function SayChainView({ puzzle, state, dispatch, scene, practiceCtx }: PuzzleViewProps<SayChainPuzzle, SayChainState, SayChainAction>) {
  const tablet = practiceCtx.layout === 'tablet';
  const docked = micDocked(practiceCtx.layout);
  const [step, setStep] = useState<Step>('ready');
  const [why, setWhy] = useState<PauseWhy>('pause');
  const [heard, setHeard] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const stepRef = useRef(step);
  /** Every step change goes through here, so stopped() sees it at once, not after the next render. */
  const to = (st: Step) => {
    stepRef.current = st;
    setStep(st);
  };
  const epoch = useRef(0); // bumped by Pause: what was under way before it must not go on
  const timers = useRef<number[]>([]);
  const takeUrl = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useStopAudioOnUnmount();
  useEffect(
    () => () => {
      timers.current.forEach((h) => window.clearTimeout(h));
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    },
    [],
  );
  const later = useCallback((fn: () => void, ms: number) => {
    const h = window.setTimeout(fn, ms);
    timers.current.push(h);
    return h;
  }, []);
  const stopped = () => stepRef.current === 'ready' || stepRef.current === 'paused' || stepRef.current === 'end';
  /** The flow that started in epoch e may go on (no Pause since, not ended). */
  const alive = (e: number) => e === epoch.current && !stopped();

  const done = sayChain.isDone(puzzle, state);
  const item: ChainItem | undefined = puzzle.items[Math.min(state.index, puzzle.items.length - 1)];

  /** The model of item i, once; then `then`, once: on its end, a failure to load it, or a timer (cut off by another sound, stalled). */
  const playModel = useCallback(
    (i: number, then: () => void) => {
      const it = puzzle.items[i];
      if (!it) return;
      const line = findLine(scene, it.lineId);
      const unit = line?.units.find((u) => u.id === it.unitId);
      const tag = tags.unit(it.unitId);
      if (line && unit && !line.approxTimes) {
        const w = loopWindowFor(line, unit);
        audio.playRange(scene.audio.src, w.startMs, w.endMs, { loop: false, tag, ...onceDone(then, w.endMs - w.startMs, later) });
      } else if (it.drill) audio.play(it.drill, { tag, ...onceDone(then, DRILL_MS, later) });
      else then();
    },
    [puzzle, scene, later],
  );

  /** Stops the chain where it is: timers and a late answer dropped, the microphone off, nothing playing. */
  const halt = (reason: PauseWhy) => {
    epoch.current++;
    timers.current.forEach((h) => window.clearTimeout(h));
    timers.current = [];
    setWhy(reason);
    to('paused');
    audio.stop();
  };

  const onTake = useCallback(
    async (take: Take) => {
      if (stopped() || stepRef.current !== 'listen') {
        URL.revokeObjectURL(take.url);
        return; // a take nobody waits for any more
      }
      const e = epoch.current;
      const before = stateRef.current;
      const i = before.index;
      const it = puzzle.items[i];
      if (!it) return;
      if (take.problem) {
        // No voice heard (silence, or a mumble too short): no try, not sent. The chain stops with the
        // microphone off until the kid taps to go on (after UNHEARD_LIMIT in a row, the microphone's notice).
        URL.revokeObjectURL(take.url);
        setHeard(null);
        halt(take.problem);
        if (cardRef.current) fx.wobble(cardRef.current);
        return;
      }
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
      takeUrl.current = take.url;
      let action: SayChainAction;
      to('think');
      if (before.tries + 1 >= SPEECH_MAX_TRIES) {
        // The third try always moves on: no waiting on the server (it still gets the take).
        void askSpeech({ scene: scene.id, unit: it.unitId, attempt: before.tries + 1 }, take.wav);
        action = { kind: 'timeout' };
      } else {
        // A slow server must not stall a chain: past SPEECH_TIMEOUT_MS (as every speaking type waits) the
        // item becomes a listen-back, like a server without recognition.
        const r = await askSpeech({ scene: scene.id, unit: it.unitId, attempt: before.tries + 1 }, take.wav);
        if (!alive(e)) return;
        if ('error' in r) action = { kind: 'unavailable' };
        else action = { kind: 'verdict', pass: r.res.pass, score: r.res.score, matched: r.res.matched, transcript: r.res.transcript };
      }
      const after = sayChain.reduce(puzzle, before, action);
      dispatch(action);
      if (action.kind === 'unavailable') {
        // Listen-back, hands-free: the kid's own voice, then on (also when that play fails or is cut off).
        to('back');
        const next = () => later(() => alive(e) && dispatch({ kind: 'next' }), 300);
        audio.play(take.url, { tag: 'chain:mine', ...onceDone(next, take.durationMs, later) });
        return;
      }
      if (after.index > i) {
        setHeard(null);
        to('heard');
        if (cardRef.current) fx.right(cardRef.current);
        fx.sfx(after.results[i]?.how === 'heard' ? 'coin' : 'pop');
        // (a timeout moves on too: same small reward, the chain keeps going)
        if (after.index >= puzzle.items.length) {
          later(() => {
            fx.impact();
            fx.sfx('win');
          }, 300);
        }
        return;
      }
      setHeard(action.kind === 'verdict' ? (action.transcript ?? '') : '');
      to('miss');
      if (cardRef.current) fx.wobble(cardRef.current);
      later(() => alive(e) && runRef.current(i), 900);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, scene, dispatch, later],
  );

  const rec = useRecorder((take) => void onTake(take));

  /** One round of item i: the model, then the microphone. */
  const run = useCallback(
    (i: number) => {
      if (stopped() || i >= puzzle.items.length) return;
      const e = epoch.current;
      to('model');
      playModel(i, () => {
        if (!alive(e)) return;
        later(() => {
          if (!alive(e)) return;
          to('listen');
          rec.record(puzzle.maxRecordMs, { silenceMs: SILENCE_MS });
        }, 150);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puzzle, playModel, rec.record, later],
  );
  const runRef = useRef(run);
  runRef.current = run;

  // A new item (after a reward or a listen-back): its round starts by itself.
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (step === 'ready' || step === 'paused' || step === 'end') return;
    if (done) {
      to('end');
      return;
    }
    if (state.index !== lastIndex.current) {
      lastIndex.current = state.index;
      if (state.index > 0) later(() => run(state.index), step === 'back' ? 200 : 650);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, done]);

  /** « C'est parti ! » and Continue: the current item from its model. */
  const start = () => {
    lastIndex.current = state.index;
    setHeard(null);
    to('model'); // out of 'ready' or 'paused' first: run() does nothing while stopped
    run(state.index);
  };
  const pause = () => {
    halt('pause');
    rec.pause();
  };
  /** The microphone failed to open, or heard nothing: « Réessayer le micro » starts the item again (the model, then the microphone). */
  const retry = () => {
    rec.reset();
    start();
  };

  // Hiding the page (another app, the screen locked) pauses the chain: nothing plays or listens unseen.
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && !stopped()) pauseRef.current();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The microphone's own screens: the first-time explanation (its OK is the tap that opens it), a refusal, a deaf microphone.
  const notice = isNotice(rec.status);
  const listening = rec.status === 'recording';
  const thinking = step === 'think';
  const waiting = step === 'model' || step === 'heard' || step === 'miss' || step === 'back';
  const statusText =
    step === 'ready' ? t('puzzles.say-chain.ready') :
    step === 'paused' ? (why === 'pause' ? t('puzzles.say-chain.paused') : rec.unheard >= 2 ? t('puzzles.speak.silentAgain') : why === 'short' ? t('puzzles.speak.short') : t('puzzles.speak.silent')) :
    step === 'miss' ? t('puzzles.say-chain.again') :
    step === 'back' ? t('puzzles.speak.listenBack.title') :
    null;

  // « Je ne peux pas parler », what the chain says, and the microphone: in the dock on a phone (the
  // compact control), so the item above stays readable and the control never scrolls away.
  const status = (
    <>
      <CantSpeak practiceCtx={practiceCtx} onPress={() => to('end')} nudge={rec.unheard >= 2} />
      <div className={cx(s.status, docked && s.statusDocked)} aria-live="polite" data-chain-status={thinking ? 'think' : step}>
        {/* A line of its own height, so the microphone under it does not jump between steps. */}
        <div className={s.line}>
          {statusText && (
            <p className={cx(s.say, step === 'paused' && why !== 'pause' && s.sayQuiet)} data-chain-note={step === 'paused' ? why : undefined}>
              {statusText}
              {step === 'miss' && heard ? <span className={s.heard}>{t('puzzles.speak.heard', { text: heard })}</span> : null}
            </p>
          )}
        </div>
        <MicControl
          rec={rec}
          onStart={start}
          onPause={pause}
          pauseWhen="running"
          thinking={thinking}
          waiting={waiting}
          idle={step === 'paused' ? 'resume' : 'start'}
          compact={docked}
          {...(step === 'ready' ? { idleText: t('puzzles.say-chain.start') } : {})}
          buttonData={step === 'ready' ? { 'data-chain-start': true } : step === 'paused' ? { 'data-chain-resume': true } : {}}
        />
      </div>
    </>
  );

  return (
    <div className={cx(s.puzzle, tablet && s.tablet)} data-say-chain data-step={step}>
      <ol className={s.progress} aria-label={t('puzzles.say-chain.progress', { n: Math.min(state.index + 1, puzzle.items.length), total: puzzle.items.length })}>
        {puzzle.items.map((it, i) => {
          const r = state.results[i];
          return (
            <li key={it.unitId} className={cx(s.dot, r && s.dotDone, r?.how === 'heard' && s.dotHeard, i === state.index && !done && s.dotNow)} data-chain-dot={i}>
              {r ? <Icon name={r.how === 'heard' ? 'star' : 'check'} size={18} /> : i + 1}
            </li>
          );
        })}
      </ol>

      {item && !done && (
        <div ref={cardRef} key={item.unitId} className={cx(s.card, listening && s.cardListening)} style={unitColorVars(state.index)} data-chain-item={state.index} data-speak-keep>
          <button type="button" className={s.fr} onClick={() => !listening && playModel(state.index, () => {})} lang="fr" data-chain-fr>
            {item.fr}
          </button>
          <span className={s.en} lang="en">
            {item.en}
          </span>
        </div>
      )}
      {done && (
        <div className={s.all} data-chain-end>
          {puzzle.items.map((it, i) => (
            <span key={it.unitId} className={s.allItem} style={unitColorVars(i)}>
              {it.fr}
            </span>
          ))}
        </div>
      )}

      {/* Above the microphone's notices, so it stays in view on a phone at every step. */}
      {!done && notice && (
        <>
          <CantSpeak practiceCtx={practiceCtx} onPress={() => to('end')} nudge={rec.unheard >= 2} />
          <MicNotice status={rec.status} onOk={rec.acceptIntro} onSkip={() => dispatch({ kind: 'skip' })} onRetry={retry} />
        </>
      )}
      {!done && !notice && (docked ? <MicDock>{status}</MicDock> : status)}
    </div>
  );
}
