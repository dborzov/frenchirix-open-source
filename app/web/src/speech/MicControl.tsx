// The one microphone control of every speaking puzzle type (say-line, say-hidden, act-line, say-chain,
// say-choice), so a kid always knows whether they are being listened to:
//
//   idle / paused  a red (paused: green) button with the microphone: "Tap and speak!" / "Continue". The mic is off.
//   opening        a spinner: "Turning on the mic…"; Pause cancels.
//   listening      the button turns yellow with a live level meter inside it that moves with the
//                  kid's voice (green bars when a voice is picked up), a blinking "I'm listening!"
//                  tag, and a countdown bar with the seconds left (at most LISTEN_MAX_MS, 10 s). Tap
//                  the button: done, it is sent. Pause: dropped, nothing sent, the mic is off.
//   thinking       a spinner: "Checking…" (the mic is off).
//   waiting        the speaker: "Listen…" (the model plays first; the mic is off).
//
// The meter reads the recorder's own samples (useRecorder().onLevel) and writes a CSS variable, so the
// view does not re-render 20 times a second. `data-record` keeps the recorder's status for the tests.
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { t } from '../../../shared/i18n';
import { fx } from '../fx';
import { Icon, Spinner, Stamp, cx } from '../ui';
import { keepAboveDock } from './dock';
import s from './MicControl.module.css';
import type { UseRecorder } from './useRecorder';

export type MicLook = 'idle' | 'paused' | 'opening' | 'listening' | 'thinking' | 'waiting';

export interface MicControlProps {
  rec: UseRecorder;
  /** Tap to speak (idle), or to go on (paused). */
  onStart: () => void;
  /** Shown while the microphone opens or listens: drops the take (or pauses a hands-free chain). */
  onPause?: () => void;
  /** The take is being checked by the server (the recorder is already done). */
  thinking?: boolean;
  /** The microphone waits for something to play first (say-chain's model). */
  waiting?: boolean;
  /** What the idle button says: start ("Tap and speak!"), again ("One more time!"), resume ("Continue"). */
  idle?: 'start' | 'again' | 'resume';
  /** Another text for the idle button (say-chain's « C'est parti ! »). */
  idleText?: string;
  /** When Pause shows: while the microphone opens or listens (default), or at every running step (a hands-free chain). */
  pauseWhen?: 'listening' | 'running';
  /** Extra attributes for the main button (tests: data-chain-start, data-chain-resume). */
  buttonData?: Record<`data-${string}`, string | boolean | undefined>;
  /** A small stamp on the control (the try counter). */
  badge?: string | null;
  compact?: boolean;
  refEl?: RefObject<HTMLButtonElement | null>;
}

const BARS = [0.55, 0.85, 1, 0.8, 0.5];

export function micLook(p: Pick<MicControlProps, 'rec' | 'thinking' | 'waiting' | 'idle'>): MicLook {
  const st = p.rec.status;
  if (st === 'recording') return 'listening';
  if (st === 'opening') return 'opening';
  if (st === 'processing' || p.thinking) return 'thinking';
  if (p.waiting) return 'waiting';
  return p.idle === 'resume' ? 'paused' : 'idle';
}

export function MicControl(props: MicControlProps) {
  const { rec, onStart, onPause, compact, refEl, badge } = props;
  const look = micLook(props);
  const wrap = useRef<HTMLDivElement>(null);
  const listening = look === 'listening';
  const open = listening || look === 'opening';

  // The microphone is never open without its listening control in view (tag, meter, countdown, Pause):
  // on a tablet a long puzzle puts the control under the fold, and it grows when it starts listening. In
  // the dock (a phone) it is always in view: the French being said is kept readable above the dock.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = wrap.current;
      if (el?.closest('[data-mic-dock]')) keepAboveDock(el, !fx.reducedMotion());
      else el?.scrollIntoView?.({ block: 'nearest', behavior: fx.reducedMotion() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [open, look]);

  // The live level: straight into a CSS variable (and a class while a voice is picked up).
  useEffect(() => {
    if (!listening) return;
    const el = wrap.current;
    const off = rec.onLevel((level, voice) => {
      if (!el) return;
      el.style.setProperty('--lvl', level.toFixed(2));
      el.classList.toggle(s.voice!, voice);
    });
    return () => {
      off();
      el?.style.setProperty('--lvl', '0');
      el?.classList.remove(s.voice!);
    };
  }, [listening, rec]);

  const label =
    look === 'listening' ? t('puzzles.speak.tapDone') :
    look === 'opening' ? t('puzzles.speak.opening') :
    look === 'thinking' ? t('puzzles.speak.checking') :
    look === 'waiting' ? t('puzzles.speak.waitListen') :
    props.idleText ? props.idleText :
    look === 'paused' ? t('puzzles.speak.resume') :
    props.idle === 'again' ? t('puzzles.speak.recordAgain') : t('puzzles.speak.record');
  const press = () => {
    if (look === 'listening') rec.stop();
    else if (look === 'idle' || look === 'paused') onStart();
  };
  const disabled = look === 'opening' || look === 'thinking' || look === 'waiting';
  const recordAttr = rec.status === 'recording' ? 'recording' : props.thinking ? 'processing' : rec.status;
  const showPause = !!onPause && (props.pauseWhen === 'running' ? look !== 'idle' && look !== 'paused' : look === 'listening' || look === 'opening');
  // Pause by itself, as the Pause button does: when a dialog comes over the puzzle (« Une pause ? », the
  // report form; once the take ran out behind « Une pause ? » and was checked, and say-chain went on to
  // its next item), when the help strip opens (the kid turned to the lines), and when the page is hidden
  // (the take is dropped, no try spent). A dialog already open counts (act-line opens the microphone
  // by itself); a help strip already open does not (the kid may speak with it open).
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  useEffect(() => {
    if (!showPause) return;
    const helpOpen = () => !!document.querySelector('[data-help="open"]');
    let help = helpOpen();
    const check = () => {
      const h = helpOpen();
      if (document.querySelector('[aria-modal="true"]') || (h && !help)) onPauseRef.current?.();
      help = h;
    };
    check();
    const watch = new MutationObserver(check);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-help', 'aria-modal'] });
    const onVis = () => document.visibilityState === 'hidden' && onPauseRef.current?.();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      watch.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [showPause]);
  const pauseBtn = showPause && (
    <button type="button" className={s.pause} onClick={onPause} title={t('puzzles.speak.pause')} data-mic-pause>
      <Icon name="pause" size={20} />
      <span>{t('puzzles.speak.pause')}</span>
    </button>
  );

  return (
    <div ref={wrap} className={cx(s.mic, s[look], compact && s.compact)} data-mic={look}>
      <div className={s.stage}>
        <button ref={refEl} type="button" className={s.btn} onClick={press} disabled={disabled} aria-label={listening ? t('puzzles.speak.stop') : label} data-record={recordAttr} {...props.buttonData}>
          {listening ? (
            <span className={s.bars} aria-hidden>
              {BARS.map((k, i) => (
                <b key={i} style={{ '--k': k } as CSSProperties} />
              ))}
            </span>
          ) : look === 'opening' || look === 'thinking' ? (
            <Spinner size={compact ? 'sm' : 'md'} />
          ) : (
            <Icon name={look === 'waiting' ? 'speaker' : 'mic'} size={compact ? 34 : 54} />
          )}
        </button>
        {badge && !compact && (
          <Stamp variant="issue" color="paper" tilt={6} className={s.badge}>
            {badge}
          </Stamp>
        )}
      </div>
      <div className={s.side}>
        {(listening || (compact && pauseBtn)) && (
          <span className={s.sideTop}>
            {listening && (
              <span className={s.onAir} role="status">
                <i className={s.dot} aria-hidden />
                {t('puzzles.speak.onAir')}
              </span>
            )}
            {compact && pauseBtn}
          </span>
        )}
        {listening && rec.clock ? <Countdown key={rec.clock.id} limitMs={rec.clock.limitMs} startedAt={rec.clock.startedAt} /> : null}
        <span className={s.label}>{label}</span>
        {/* Compact: the try counter beside the button, not over it. */}
        {badge && compact && !listening && (
          <Stamp variant="issue" color="paper" tilt={4} className={s.badgeSide}>
            {badge}
          </Stamp>
        )}
      </div>
      {!compact && pauseBtn}
    </div>
  );
}

/** A thick bar that empties over the take's limit, with the seconds left. */
function Countdown({ limitMs, startedAt }: { limitMs: number; startedAt: number }) {
  const left = () => Math.max(0, Math.ceil((limitMs - (performance.now() - startedAt)) / 1000));
  const [secs, setSecs] = useState(left);
  useEffect(() => {
    const id = window.setInterval(() => setSecs(left()), 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const elapsed = Math.max(0, performance.now() - startedAt);
  return (
    <span className={cx(s.countdown, secs <= 3 && s.late)} data-countdown={secs}>
      <span className={s.track} aria-hidden>
        <i style={{ animationDuration: `${limitMs}ms`, animationDelay: `-${Math.round(elapsed)}ms` }} />
      </span>
      <b className={s.secs} aria-label={t('puzzles.speak.secondsLeft', { n: secs })}>
        {secs}
      </b>
    </span>
  );
}
