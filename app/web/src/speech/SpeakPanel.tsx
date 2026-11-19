// The speaking panel every microphone puzzle with one target uses (say-line, say-hidden, act-line):
// the microphone control (MicControl: off, opening, listening with a live meter and a countdown,
// checking), the first-time microphone explanation, the denied-microphone way out, the feedback after
// each try (what was heard, what is still missing; the puzzle type lights the boxes from state.lit),
// and the listen-back round (the original, then the kid's own voice, then "c'est moi !") when
// recognition is unavailable. The third try always passes (speak-core.ts), with the same celebration
// as a real pass. On a phone (and a tablet held sideways) the control, « Je ne peux pas parler » and
// the note sit in the dock at the bottom of the puzzle (dock.ts), the French kept readable above it.
//
// A take in which no voice was heard (silent, or too short) is not sent and spends no try: "I didn't
// hear anything", and the microphone again; after two in a row the note points at "Je ne peux pas
// parler" (which wiggles); after UNHEARD_LIMIT in a row the microphone's notice offers skip and retry.
// So nothing ever says it heard the kid when it did not.
// The take stays in memory for this round only (an object URL, revoked on unmount).
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { SpeechQuery } from '../../../shared/api';
import { speakReduce, type SpeakAction, type SpeakState } from '../../../shared/puzzles/speak-core';
import { t } from '../../../shared/i18n';
import { SPEECH_MAX_TRIES } from '../../../shared/rules';
import { audio, onceDone, useIsPlaying, type PlayOptions } from '../audio';
import { fx } from '../fx';
import { log, puzzleWhere } from '../log';
import type { PracticeCtx } from '../puzzles/registry';
import { useLater } from '../puzzles/useLater';
import { Balloon, Button, Icon, IconButton, Panel, cx } from '../ui';
import { keepAboveDock, micDocked } from './dock';
import { MicControl } from './MicControl';
import type { Take } from './recorder';
import { sendSpeech } from './send';
import s from './SpeakPanel.module.css';
import { isNotice, useRecorder, type RecorderStatus } from './useRecorder';

/** How a view plays its original: once (with its end and error reported) or looping. */
export type PlayOriginal = (opts?: { loop?: boolean } & Pick<PlayOptions, 'onEnd' | 'onError'>) => void;

export interface SpeakPanelProps {
  query: SpeechQuery;
  maxRecordMs: number;
  state: SpeakState;
  dispatch: (a: SpeakAction) => void;
  /** Play the original (the line or unit) from the scene; looping unless told otherwise. */
  playOriginal: PlayOriginal;
  /** The original's length (ms), so a wait on it has an end (onceDone). */
  originalMs: number;
  practiceCtx: PracticeCtx;
  /** Called on a passing verdict, after the panel's own impact (the puzzle type flips its letters, etc.). */
  onPass?: () => void;
  /**
   * After a try that did not pass: replay what is missing (default: the whole target, looping). Gets
   * the words heard so far (state.lit after this try).
   */
  onMiss?: (lit: boolean[]) => void;
  /** Start a take by itself whenever this changes to a new non-zero value (act-line's "à toi !"). */
  autoStartKey?: number;
  /** End-of-speech silence for long lines (ms; default the recorder's SILENCE_MS, 1.5 s). */
  silenceMs?: number;
  /**
   * Set to a function that drops the take under way, if any (the microphone off, nothing sent, no
   * note): a view's own play buttons call it before they play (act-line's « Réécouter la scène »,
   * say-line's speaker, say-hidden's « Écouter »), since nothing plays while the microphone is open
   * (useRecorder).
   */
  dropTake?: MutableRefObject<(() => void) | null>;
  /** How a word still to say is shown after a miss (say-hidden: masked like its tiles, never spelled out); `i` is its index among the expected words. */
  showMissing?: (word: string, i: number) => string;
}

const MINE = 'speak:mine';

type Note = 'silent' | 'short' | 'paused' | null;

/**
 * The speaking panel, with the "Je ne peux pas parler" button above it at every step of the round
 * (before the microphone, while recording, after a try, in listen-back, on the denied screen).
 * Pressing it turns speaking off for the practice (saved in the profile): the shell replaces this round
 * and every later microphone round with its tapping equivalent on the same French (puzzle.alt).
 */
export function SpeakPanel(props: SpeakPanelProps) {
  return <SpeakPanelBody {...props} />;
}

/** "Je ne peux pas parler": every microphone puzzle shows it at every step. `nudge` makes it wiggle once (after two takes with no voice). */
export function CantSpeak({ practiceCtx, onPress, nudge }: { practiceCtx: PracticeCtx; onPress?: () => void; nudge?: boolean }) {
  const setSpeak = practiceCtx.setSpeak;
  if (!setSpeak) return null;
  return (
    <div className={s.cantRow}>
      <button
        type="button"
        className={cx(s.cant, nudge && s.cantNudge)}
        onClick={() => {
          log('cant-speak', { from: 'puzzle', type: puzzleWhere()?.type ?? null });
          onPress?.();
          audio.stop();
          setSpeak(false);
        }}
        data-cant-speak
      >
        <Icon name="mute" size={22} />
        <span>{t('puzzles.speak.cantTalk')}</span>
      </button>
    </div>
  );
}

/** The dock at the bottom of a speaking puzzle on a phone or a tablet held sideways (dock.ts): stuck there, so the microphone never scrolls away. */
export function MicDock({ children, ...rest }: { children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={s.dock} data-mic-dock {...rest}>
      {children}
    </div>
  );
}

/**
 * The microphone's own screens, the same in every speaking puzzle type: the first-time explanation
 * ('intro'), and a microphone that cannot be used ('denied', 'unsupported', 'error') or heard no voice
 * in UNHEARD_LIMIT takes in a row ('deaf'), with skip and, where it can help, retry.
 */
/** The notice's own words where a screen needs others than a speaking puzzle's (karaoke: what is kept, where "skip" leads). */
export interface MicNoticeWords {
  introTitle?: string;
  introText?: string;
  introOk?: string;
  deniedText?: string;
  deafText?: string;
  skip?: string;
}

/** `onSkip` on the first-time explanation too (karaoke: « Retour à la chanson » beside « D'accord ! »), so the browser's Block is not the only way to say no. */
export function MicNotice({ status, onOk, onSkip, onRetry, words, introSkip }: { status: RecorderStatus | string; onOk: () => void; onSkip: () => void; onRetry: () => void; words?: MicNoticeWords; introSkip?: boolean }) {
  if (status === 'intro')
    return (
      <Panel color="yellow" tilt={-1} className={s.notice} data-mic-intro>
        <span className={s.noticeIcon}>
          <Icon name="mic" size={40} />
        </span>
        <h3 className={s.noticeTitle}>{words?.introTitle ?? t('puzzles.speak.intro.title')}</h3>
        <p className={s.noticeText}>{words?.introText ?? t('puzzles.speak.intro.text')}</p>
        <div className={s.noticeButtons}>
          <Button color="green" size="lg" icon="mic" onClick={onOk} data-mic-ok>
            {words?.introOk ?? t('puzzles.speak.intro.ok')}
          </Button>
          {introSkip && (
            <Button color="white" icon="back" onClick={onSkip} data-mic-skip>
              {words?.skip ?? t('puzzles.speak.skip')}
            </Button>
          )}
        </div>
      </Panel>
    );
  const title = status === 'error' ? t('puzzles.speak.error') : status === 'deaf' ? t('puzzles.speak.deaf.title') : t('puzzles.speak.denied.title');
  const text = status === 'error' ? null : status === 'deaf' ? (words?.deafText ?? t('puzzles.speak.deaf.text')) : (words?.deniedText ?? t('puzzles.speak.denied.text'));
  return (
    <Panel color="white" tilt={1} className={s.notice} data-mic-denied={status}>
      <span className={cx(s.noticeIcon, s.noticeIconOff)}>
        <Icon name="mute" size={40} />
      </span>
      <h3 className={s.noticeTitle}>{title}</h3>
      {text && <p className={s.noticeText}>{text}</p>}
      <div className={s.noticeButtons}>
        <Button color="yellow" size="lg" iconRight="forward" onClick={onSkip} data-mic-skip>
          {words?.skip ?? t('puzzles.speak.skip')}
        </Button>
        {status !== 'unsupported' && (
          <Button color="white" icon="mic" onClick={onRetry} data-mic-retry>
            {t('puzzles.speak.retry')}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** The note after a take that was not judged: nothing heard (twice: point at "Je ne peux pas parler"), too short, paused. */
function noteText(note: Note, unheard: number): string {
  if (note === 'paused') return t('puzzles.speak.paused');
  if (note === 'short') return unheard >= 2 ? t('puzzles.speak.silentAgain') : t('puzzles.speak.short');
  return unheard >= 2 ? t('puzzles.speak.silentAgain') : t('puzzles.speak.silent');
}

function SpeakPanelBody({ query, maxRecordMs, state, dispatch, playOriginal, originalMs, practiceCtx, onPass, onMiss, autoStartKey, silenceMs, dropTake, showMissing }: SpeakPanelProps) {
  const docked = micDocked(practiceCtx.layout);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [hasTake, setHasTake] = useState(false);
  const takeUrl = useRef<string | null>(null);
  const takeMs = useRef(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const later = useLater();
  const mineOn = useIsPlaying(MINE);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    };
  }, []);

  const playMine = useCallback(
    (then?: () => void) => {
      if (!takeUrl.current) return;
      audio.play(takeUrl.current, { tag: MINE, ...(then ? onceDone(then, takeMs.current, later) : {}) });
    },
    [later],
  );

  /** Listen-back: the original once, then the kid's voice (also when the original fails or is cut off). */
  const listenBack = useCallback(() => {
    playOriginal({ loop: false, ...onceDone(() => playMine(), originalMs, later) });
  }, [playOriginal, playMine, originalMs, later]);

  const onTake = useCallback(
    async (take: Take) => {
      const before = stateRef.current;
      if (take.problem) {
        // No voice heard (silent, or too short): not sent, and no try spent. The microphone comes back;
        // useRecorder counts these in a row (the note points at "Je ne peux pas parler" after two, the
        // microphone's notice comes after UNHEARD_LIMIT).
        URL.revokeObjectURL(take.url);
        setNote(take.problem);
        if (btnRef.current) fx.wobble(btnRef.current);
        return;
      }
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
      takeUrl.current = take.url;
      takeMs.current = take.durationMs;
      setHasTake(true);
      setNote(null);
      if (before.mode === 'listen-back') {
        listenBack();
        return;
      }
      let action: Awaited<ReturnType<typeof sendSpeech>>;
      if (before.tries + 1 >= SPEECH_MAX_TRIES) {
        // The third try always passes: no waiting on the server, never a "fail". The take is still
        // sent (the server keeps its counters), in the background.
        void sendSpeech({ ...query, attempt: before.tries + 1 }, take.wav);
        const words = before.last?.matched ?? [];
        action = { kind: 'verdict', pass: false, score: 0, matched: words.map((m, i) => ({ word: m.word, ok: !!before.lit[i] })) };
      } else {
        setSending(true);
        action = await sendSpeech({ ...query, attempt: before.tries + 1 }, take.wav);
      }
      if (!live.current) return;
      setSending(false);
      if (action.kind === 'unavailable') {
        dispatch(action);
        listenBack();
        return;
      }
      // What the reducer will decide (pure): a pass, every word heard by now, or the third try.
      const after = speakReduce(before, action);
      dispatch(action);
      if (after.done === 'passed') {
        if (btnRef.current) fx.right(btnRef.current);
        later(() => fx.impact(), 250);
        onPass?.();
        playOriginal({ loop: true });
      } else {
        if (btnRef.current) fx.wobble(btnRef.current);
        // What is missing, then the whole target, so the kid hears it before the next go.
        if (onMiss) onMiss(after.lit);
        else playOriginal({ loop: true });
      }
    },
    [query, dispatch, listenBack, playOriginal, onPass, onMiss, later],
  );

  const rec = useRecorder((take) => void onTake(take));

  const start = useCallback(() => {
    if (stateRef.current.done) return;
    setNote(null);
    audio.stop();
    rec.record(maxRecordMs, silenceMs ? { silenceMs } : {});
  }, [rec, maxRecordMs, silenceMs]);

  const pause = () => {
    rec.pause();
    setNote('paused');
  };

  const micOpen = rec.status === 'opening' || rec.status === 'recording';
  useEffect(() => {
    if (!dropTake) return;
    dropTake.current = micOpen ? rec.pause : null;
    return () => {
      dropTake.current = null;
    };
  }, [dropTake, micOpen, rec.pause]);

  // "À toi !": the puzzle type asks for a take by itself (after the first permission, the mic just opens).
  const lastAuto = useRef(0);
  useEffect(() => {
    if (!autoStartKey || autoStartKey === lastAuto.current) return;
    lastAuto.current = autoStartKey;
    if (stateRef.current.done || stateRef.current.mode !== 'speak') return;
    if (rec.status !== 'idle') return;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartKey]);

  // The one thing to tap next stays in view: the panel changes height under the kid's finger (the
  // first-time explanation replaces the microphone, the feedback balloon grows above it after a miss,
  // listen-back adds its pair of buttons), which pushed that thing below the fold on a phone.
  const notice = isNotice(rec.status);
  const shownKey = [notice ? rec.status : 'normal', state.mode, state.tries, note, hasTake, rec.unheard].join('|');
  const lastShown = useRef(shownKey);
  useEffect(() => {
    if (shownKey === lastShown.current) return; // not on mount (nor StrictMode's second run)
    lastShown.current = shownKey;
    if (state.done) return;
    const id = requestAnimationFrame(() => {
      // Docked (a phone, a tablet held sideways): the dock is always in view; the French being said is kept readable above it.
      if (docked && !notice && state.mode !== 'listen-back') return keepAboveDock(btnRef.current, !fx.reducedMotion());
      const pane = btnRef.current?.closest('[data-puzzle-pane]') ?? document.querySelector('[data-puzzle-pane]');
      // The microphone's notice: its last button (« Réessayer le micro », under « Passer »), so both show.
      const next = pane?.querySelector('[data-mic-retry]') ?? pane?.querySelector('[data-mic-ok], [data-mic-skip], [data-speak-me]:not(:disabled), [data-mic]') ?? btnRef.current;
      next?.scrollIntoView({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, state.done]);

  // Tap-to-speak types: the microphone in view from the start (on a tablet a long puzzle pushes it under
  // the fold; on a phone it is docked, and the French is kept readable above the dock). act-line opens it
  // by itself, and scrolls its turn into view itself.
  useEffect(() => {
    if (autoStartKey !== undefined) return;
    later(() => {
      if (!live.current || stateRef.current.done) return;
      if (docked) keepAboveDock(btnRef.current, !fx.reducedMotion());
      else btnRef.current?.closest('[data-mic]')?.scrollIntoView?.({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cant = state.done === null && <CantSpeak practiceCtx={practiceCtx} nudge={rec.unheard >= 2} />;

  // ---- the microphone's own screens: the first-time explanation, no microphone, a microphone that hears nothing ----
  if (notice) {
    return (
      <>
        {cant}
        <MicNotice status={rec.status} onOk={rec.acceptIntro} onSkip={() => dispatch({ kind: 'skip' })} onRetry={rec.reset} />
      </>
    );
  }

  const control = (idle: 'start' | 'again', badge: string | null, compact = false) => (
    <MicControl rec={rec} refEl={btnRef} onStart={start} onPause={pause} thinking={sending} idle={idle} badge={badge} compact={compact} />
  );
  const noteBalloon = note && (
    <Balloon tail="bottom" tailAt="50%" boxy className={s.balloon} data-speak-note={note}>
      {noteText(note, rec.unheard)}
    </Balloon>
  );

  // ---- listen-back: no recognition today ----
  if (state.mode === 'listen-back') {
    return (
      <>
        {cant}
        <Panel color="paper" className={s.listenBack} data-listen-back>
          <h3 className={s.noticeTitle}>{t('puzzles.speak.listenBack.title')}</h3>
          <p className={s.noticeText}>{t('puzzles.speak.listenBack.text')}</p>
          <div className={s.pair}>
            <button type="button" className={cx(s.big, s.bigOriginal)} onClick={() => playOriginal({ loop: false })} data-play-original>
              <Icon name="speaker" size={40} />
              <span>{t('puzzles.speak.original')}</span>
            </button>
            <button type="button" className={cx(s.big, s.bigMine, mineOn && s.bigOn)} onClick={() => playMine()} disabled={!hasTake} data-play-mine>
              <Icon name="mic" size={40} />
              <span>{t('puzzles.speak.mine')}</span>
            </button>
          </div>
          {!hasTake && (
            <>
              {noteBalloon}
              {control('start', null)}
            </>
          )}
          {state.done === null && (
            <Button color="green" size="lg" icon="check" onClick={(e) => { fx.right(e.currentTarget); dispatch({ kind: 'me' }); }} disabled={!hasTake} data-speak-me>
              {t('puzzles.speak.me')}
            </Button>
          )}
        </Panel>
      </>
    );
  }

  // ---- the normal round ----
  const failed = !!state.last && !state.last.pass && state.done === null;
  // What is still missing: the expected words not heard in any try so far.
  const missing = state.last ? state.last.matched.flatMap((m, i) => (state.lit[i] ? [] : [showMissing ? showMissing(m.word, i) : m.word])) : [];
  const busy = rec.status === 'opening' || rec.status === 'recording' || rec.status === 'processing' || sending;
  // The last verdict stays up during the next take (the control under it must not jump), not while it is
  // checked; in the dock it steps aside while the microphone is open, so the French above stays in view.
  const verdict = !note && !sending && (state.done === 'passed' || failed) && !(docked && micOpen);
  const hearMe = hasTake && !busy;
  const verdictBalloon = verdict && (
    <Balloon tail="bottom" tailAt="50%" boxy className={cx(s.balloon, state.done === 'passed' && s.balloonWin)} data-speak-note={state.done === 'passed' ? 'passed' : 'failed'}>
      {state.done === 'passed' ? (
        // After an unrecognised third try nothing claims it heard the line: a plain "bravo".
        state.auto ? t('puzzles.speak.passedAuto') : t('puzzles.speak.passed')
      ) : (
        <>
          {t(state.tries % 2 ? 'puzzles.speak.try1' : 'puzzles.speak.try2')}
          {state.last?.transcript !== undefined && (
            <span className={s.heardLine} data-heard>
              {t('puzzles.speak.heard', { text: state.last.transcript.trim() || '…' })}
            </span>
          )}
          {/* In the dock the boxes or tiles not lit say it: the balloon stays short, the French above in view. */}
          {missing.length > 0 && !docked && (
            <span className={s.missing} data-missing>
              {t('puzzles.speak.missing', { words: missing.join(' ') })}
            </span>
          )}
        </>
      )}
    </Balloon>
  );
  const idle = state.tries > 0 ? 'again' : 'start';
  const badge = state.tries > 0 ? t('puzzles.speak.tries', { n: state.tries + 1, max: SPEECH_MAX_TRIES }) : null;

  // ---- a phone (or a tablet held sideways): everything in the dock at the bottom of the puzzle ----
  if (docked)
    return (
      <MicDock data-speak={rec.status}>
        {(state.done === null || hearMe) && (
          <div className={s.dockTop}>
            {cant}
            {hearMe && <IconButton icon={mineOn ? 'stop' : 'play'} label={t('puzzles.speak.hearMe')} size="sm" color="white" onClick={() => (mineOn ? audio.stop() : playMine())} data-hear-me />}
          </div>
        )}
        {noteBalloon}
        {verdictBalloon}
        {state.done === null && control(idle, badge, true)}
      </MicDock>
    );

  return (
    <>
      {cant}
      <div className={s.panel} data-speak={rec.status}>
        {noteBalloon}
        {verdictBalloon}
        {state.done === null && control(idle, badge)}
        {hearMe && (
          <div className={s.row}>
            <Button size="sm" color="white" icon={mineOn ? 'stop' : 'mic'} onClick={() => (mineOn ? audio.stop() : playMine())} data-hear-me>
              {t('puzzles.speak.hearMe')}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
